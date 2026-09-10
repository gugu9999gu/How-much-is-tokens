const { ipcMain } = require("electron");
const { loadSettings, saveSettings, invalidateSecretStatusCache } = require("./settings");
const { apiProviderById, apiProviderCatalog } = require("./api-providers/registry");
const {
  normalizeMediaProviderProfiles,
  nextMediaProfile,
  officialMcpFor,
  cleanMediaProfileId,
} = require("./media-provider-profiles");
const {
  saveApiProviderSecrets,
  clearApiProviderSecrets,
  loadApiProviderSecrets,
  saveMediaProviderProfileSecrets,
  loadMediaProviderProfileSecrets,
  clearMediaProviderProfileSecrets,
} = require("./secure-secrets");
const { authorizeMediaMcp } = require("./media-mcp-client");
require("./window-resize-main-integration");
require("./cli-maintenance-main-integration");

function providerOrThrow(providerId) {
  const provider = apiProviderById(providerId);
  if (!provider) throw new Error("등록되지 않은 API 공급자입니다.");
  return provider;
}

function allowedPatch(provider, patch) {
  const allowed = new Set((provider.credentials || []).map((cred) => cred.key));
  const out = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (allowed.has(field) && typeof value === "string" && value.trim()) out[field] = value.trim();
  }
  return out;
}

function mediaProfile(settings, providerId, profileId) {
  const id = cleanMediaProfileId(profileId);
  return normalizeMediaProviderProfiles(settings.mediaProviderProfiles)
    .find((profile) => profile.providerId === String(providerId || "").toLowerCase() && profile.id === id) || null;
}

function allCredentialFields(provider) {
  return (provider.credentials || []).map((cred) => cred.key);
}

function credentialsComplete(provider, patch) {
  const filtered = allowedPatch(provider, patch);
  const required = allCredentialFields(provider);
  return required.length > 0 && required.every((field) => !!filtered[field]);
}

function sameCredentials(left, right, fields) {
  if (!fields.length) return false;
  return fields.every((field) => String(left && left[field] || "") === String(right && right[field] || "") && !!String(left && left[field] || ""));
}

function findDuplicateMediaCredentials(settings, provider, credentials) {
  const fields = allCredentialFields(provider);
  if (!credentialsComplete(provider, credentials)) return null;
  const legacy = loadApiProviderSecrets(provider.id, fields);
  if (sameCredentials(legacy, credentials, fields)) return { kind: "default", label: "기본 연결" };
  for (const profile of normalizeMediaProviderProfiles(settings.mediaProviderProfiles).filter((item) => item.providerId === provider.id)) {
    const stored = loadMediaProviderProfileSecrets(provider.id, profile.id, fields);
    if (sameCredentials(stored, credentials, fields)) return { kind: "profile", profileId: profile.id, label: profile.label };
  }
  return null;
}

async function createMediaProviderAccount(providerId, options = {}) {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  if (settings.secureStorageAvailable !== true) throw new Error("운영체제 보안 저장소를 사용할 수 없어 계정을 추가할 수 없습니다.");
  const mcp = officialMcpFor(provider.id);
  const mode = options.mode === "mcp" ? "mcp" : "api";
  if (mode === "mcp" && !mcp) return { ok: false, providerId: provider.id, reason: "mcp-not-supported" };
  if (mode === "mcp" && mcp.auth === "oauth") {
    return connectMediaProviderMcp(provider.id, { createNew: true, label: options.label });
  }

  const credentials = allowedPatch(provider, options.credentials || {});
  if (!credentialsComplete(provider, credentials)) {
    return { ok: false, providerId: provider.id, reason: "credentials-incomplete", error: "필요한 API 자격증명을 모두 입력하세요." };
  }
  const duplicate = findDuplicateMediaCredentials(settings, provider, credentials);
  if (duplicate) {
    return { ok: false, providerId: provider.id, reason: "duplicate-account", duplicate: true, accountLabel: duplicate.label, profileId: duplicate.profileId || null };
  }
  const profile = nextMediaProfile(settings, provider.id, { label: options.label, mode });
  if (!profile) return { ok: false, providerId: provider.id, reason: "profile-limit" };
  const before = normalizeMediaProviderProfiles(settings.mediaProviderProfiles);
  try {
    saveSettings({ mediaProviderProfiles: [...before, profile] });
    saveMediaProviderProfileSecrets(provider.id, profile.id, credentials);
    invalidateSecretStatusCache();
    return { ok: true, providerId: provider.id, profileId: profile.id, accountLabel: profile.label, mode, settings: loadSettings() };
  } catch (error) {
    try { clearMediaProviderProfileSecrets(provider.id, profile.id); } catch {}
    try { saveSettings({ mediaProviderProfiles: before }); } catch {}
    throw error;
  }
}

async function connectMediaProviderMcp(providerId, options = {}) {
  const provider = providerOrThrow(providerId);
  const mcp = officialMcpFor(provider.id);
  if (!mcp) return { ok: false, providerId: provider.id, reason: "mcp-not-supported" };
  if (mcp.auth !== "oauth") {
    return { ok: false, providerId: provider.id, reason: "mcp-api-key-required", error: "이 MCP는 API Key 방식입니다. + 계정에서 MCP를 선택해 키를 추가하세요." };
  }
  const settings = loadSettings();
  if (settings.secureStorageAvailable !== true) throw new Error("운영체제 보안 저장소를 사용할 수 없어 MCP OAuth를 저장할 수 없습니다.");
  const before = normalizeMediaProviderProfiles(settings.mediaProviderProfiles);
  const createNew = options.createNew !== false;
  let profile = createNew ? nextMediaProfile(settings, provider.id, { label: options.label, mode: "mcp" }) : mediaProfile(settings, provider.id, options.profileId);
  if (!profile) return { ok: false, providerId: provider.id, reason: createNew ? "profile-limit" : "profile-not-found" };
  let created = false;
  try {
    if (createNew) {
      saveSettings({ mediaProviderProfiles: [...before, profile] });
      created = true;
      profile = mediaProfile(loadSettings(), provider.id, profile.id) || profile;
    }
    const auth = await authorizeMediaMcp(provider.id, profile);
    if (!auth.ok) {
      if (created) {
        try { clearMediaProviderProfileSecrets(provider.id, profile.id); } catch {}
        try { saveSettings({ mediaProviderProfiles: before }); } catch {}
      }
      return { ...auth, providerId: provider.id, profileId: profile.id, accountLabel: profile.label };
    }
    invalidateSecretStatusCache();
    return { ok: true, providerId: provider.id, profileId: profile.id, accountLabel: profile.label, mode: "mcp", settings: loadSettings() };
  } catch (error) {
    if (created) {
      try { clearMediaProviderProfileSecrets(provider.id, profile.id); } catch {}
      try { saveSettings({ mediaProviderProfiles: before }); } catch {}
    }
    throw error;
  }
}

function updateMediaProviderAccount(providerId, profileId, patch = {}) {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  const current = mediaProfile(settings, provider.id, profileId);
  if (!current) return { ok: false, providerId: provider.id, reason: "profile-not-found" };
  const profiles = normalizeMediaProviderProfiles(settings.mediaProviderProfiles).map((profile) => {
    if (profile.providerId !== provider.id || profile.id !== current.id) return profile;
    return {
      ...profile,
      label: typeof patch.label === "string" && patch.label.trim() ? patch.label.trim() : profile.label,
      enabled: Object.prototype.hasOwnProperty.call(patch, "enabled") ? patch.enabled !== false : profile.enabled,
    };
  });
  const saved = saveSettings({ mediaProviderProfiles: profiles });
  return { ok: true, providerId: provider.id, profileId: current.id, settings: saved };
}

function saveMediaProviderAccountCredentials(providerId, profileId, patch = {}) {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  const profile = mediaProfile(settings, provider.id, profileId);
  if (!profile) return { ok: false, providerId: provider.id, reason: "profile-not-found" };
  const filtered = allowedPatch(provider, patch);
  if (!Object.keys(filtered).length) return { ok: false, providerId: provider.id, reason: "credentials-empty" };
  saveMediaProviderProfileSecrets(provider.id, profile.id, filtered);
  invalidateSecretStatusCache();
  return { ok: true, providerId: provider.id, profileId: profile.id, settings: loadSettings() };
}

function removeMediaProviderAccount(providerId, profileId) {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  const profile = mediaProfile(settings, provider.id, profileId);
  if (!profile) return { ok: false, providerId: provider.id, reason: "profile-not-found" };
  clearMediaProviderProfileSecrets(provider.id, profile.id);
  const remaining = normalizeMediaProviderProfiles(settings.mediaProviderProfiles)
    .filter((item) => !(item.providerId === provider.id && item.id === profile.id));
  const saved = saveSettings({ mediaProviderProfiles: remaining });
  invalidateSecretStatusCache();
  return { ok: true, providerId: provider.id, profileId: profile.id, settings: saved };
}

ipcMain.handle("get-api-provider-catalog", () => apiProviderCatalog());

ipcMain.handle("save-api-provider-secret", (_event, providerId, patch) => {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  if (settings.secureStorageAvailable !== true) throw new Error("운영체제 보안 저장소를 사용할 수 없어 API 키를 저장할 수 없습니다.");
  const filtered = allowedPatch(provider, patch);
  if (!Object.keys(filtered).length) throw new Error("저장할 API 자격증명이 없습니다.");
  saveApiProviderSecrets(provider.id, filtered);
  invalidateSecretStatusCache();
  return loadSettings();
});

ipcMain.handle("clear-api-provider-secret", (_event, providerId) => {
  const provider = providerOrThrow(providerId);
  clearApiProviderSecrets(provider.id, allCredentialFields(provider));
  invalidateSecretStatusCache();
  return loadSettings();
});

ipcMain.handle("add-media-provider-account", (_event, providerId, options) => createMediaProviderAccount(providerId, options || {}));
ipcMain.handle("connect-media-provider-mcp", (_event, providerId, options) => connectMediaProviderMcp(providerId, options || {}));
ipcMain.handle("update-media-provider-account", (_event, providerId, profileId, patch) => updateMediaProviderAccount(providerId, profileId, patch || {}));
ipcMain.handle("save-media-provider-account-credentials", (_event, providerId, profileId, patch) => saveMediaProviderAccountCredentials(providerId, profileId, patch || {}));
ipcMain.handle("remove-media-provider-account", (_event, providerId, profileId) => removeMediaProviderAccount(providerId, profileId));

module.exports = {
  providerOrThrow,
  allowedPatch,
  mediaProfile,
  credentialsComplete,
  findDuplicateMediaCredentials,
  createMediaProviderAccount,
  connectMediaProviderMcp,
  updateMediaProviderAccount,
  saveMediaProviderAccountCredentials,
  removeMediaProviderAccount,
};
