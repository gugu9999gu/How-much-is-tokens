const crypto = require("crypto");
const { app, clipboard, ipcMain, shell } = require("electron");
const { loadSettings, saveSettings, invalidateSecretStatusCache } = require("./settings");
const {
  MAX_PROFILES,
  cleanProfileId,
  normalizeOpenRouterProfiles,
  createOpenRouterProfile,
} = require("./openrouter-profiles");
const {
  saveOpenRouterProfileSecrets,
  clearOpenRouterProfileSecrets,
  loadOpenRouterProfileSecrets,
  ensureLocalRouterToken,
} = require("./secure-secrets");
const {
  createPkceMaterial,
  buildAuthorizationUrl,
  createLoopbackCallback,
  exchangeAuthorizationCode,
} = require("./openrouter-oauth");
const {
  creatorUserIdForApiKey,
  findExistingOpenRouterAccount,
} = require("./openrouter-account-identity");
const { OpenRouterRequestRouter } = require("./openrouter-request-router");

const router = new OpenRouterRequestRouter();

function profileExists(settings, profileId) {
  const id = cleanProfileId(profileId);
  return !!id && normalizeOpenRouterProfiles(settings.openRouterProfiles).some((profile) => profile.id === id);
}

function chooseOpenRouterProfile(settings = {}, options = {}) {
  const profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
  const createNew = options && options.createNew === true;
  const requested = cleanProfileId(options && options.profileId);

  if (!createNew && profiles.length) {
    return {
      profile: profiles.find((item) => item.id === requested) || profiles[0],
      profiles,
      isNew: false,
    };
  }

  const profile = createOpenRouterProfile(profiles, {
    label: options && options.label,
  });
  if (!profile) throw new Error(`OpenRouter 프로필은 최대 ${MAX_PROFILES}개까지 등록할 수 있습니다.`);
  return { profile, profiles, isNew: true };
}

async function configure() {
  try {
    const status = await router.configure(loadSettings());
    if (status.tokenConfigured) invalidateSecretStatusCache();
    return status;
  } catch (err) {
    router.lastError = err && err.code === "EADDRINUSE" ? "port-in-use" : "listen-failed";
    return router.status();
  }
}

function sanitizedMetrics(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 32).map((row) => ({
    providerId: row && row.providerId === "openrouter" ? "openrouter" : null,
    profileId: cleanProfileId(row && row.profileId),
    remainingPct: Number.isFinite(Number(row && row.remainingPct)) ? Number(row.remainingPct) : null,
    routingRemainingPct: Number.isFinite(Number(row && row.routingRemainingPct)) ? Number(row.routingRemainingPct) : null,
    status: typeof (row && row.status) === "string" ? row.status.slice(0, 24) : null,
  })).filter((row) => row.providerId && row.profileId);
}

function secretEquals(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findDuplicateApiKey(profiles, apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return null;
  for (const profile of normalizeOpenRouterProfiles(profiles)) {
    const stored = loadOpenRouterProfileSecrets(profile.id);
    if (secretEquals(stored.apiKey, value)) return profile;
  }
  return null;
}

async function createTrackedOpenRouterProfile(options = {}) {
  const initialSettings = loadSettings();
  if (initialSettings.secureStorageAvailable !== true) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없어 OpenRouter API Key를 저장할 수 없습니다.");
  }

  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const managementKey = typeof options.managementKey === "string" ? options.managementKey.trim() : "";
  if (!apiKey) {
    return { ok: false, providerId: "openrouter", reason: "api-key-required", error: "추적할 OpenRouter API Key를 입력하세요." };
  }

  const profiles = normalizeOpenRouterProfiles(initialSettings.openRouterProfiles);
  const duplicate = findDuplicateApiKey(profiles, apiKey);
  if (duplicate) {
    return {
      ok: false,
      providerId: "openrouter",
      reason: "duplicate-key",
      error: `이미 등록된 API Key입니다 (${duplicate.label || duplicate.id}).`,
      profileId: duplicate.id,
      accountLabel: duplicate.label || duplicate.id,
    };
  }

  const profile = createOpenRouterProfile(profiles, {
    label: options.label,
    priority: options.priority,
    enabled: options.enabled,
  });
  if (!profile) {
    return {
      ok: false,
      providerId: "openrouter",
      reason: "profile-limit",
      error: `OpenRouter 프로필은 최대 ${MAX_PROFILES}개까지 등록할 수 있습니다.`,
    };
  }

  let metadataSaved = false;
  try {
    saveSettings({
      openRouterProfiles: [...profiles, profile],
      openRouterEnabled: true,
    });
    metadataSaved = true;
    saveOpenRouterProfileSecrets(profile.id, {
      apiKey,
      ...(managementKey ? { managementKey } : {}),
    });
    invalidateSecretStatusCache();
    await configure();
    return {
      ok: true,
      providerId: "openrouter",
      profileId: profile.id,
      accountLabel: profile.label,
      settings: loadSettings(),
    };
  } catch (err) {
    if (metadataSaved) {
      try {
        clearOpenRouterProfileSecrets(profile.id);
        saveSettings({
          openRouterProfiles: profiles,
          openRouterEnabled: initialSettings.openRouterEnabled === true,
        });
      } catch {}
    }
    throw err;
  }
}

async function deleteOpenRouterProfile(profileId) {
  const settings = loadSettings();
  const id = cleanProfileId(profileId);
  const profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
  const profile = id ? profiles.find((item) => item.id === id) : null;
  if (!profile) return { ok: false, providerId: "openrouter", reason: "profile-not-found" };

  const remaining = profiles.filter((item) => item.id !== id);
  const saved = saveSettings({
    openRouterProfiles: remaining,
    openRouterEnabled: remaining.length > 0 ? settings.openRouterEnabled === true : false,
  });
  invalidateSecretStatusCache();
  await configure();
  return {
    ok: true,
    providerId: "openrouter",
    profileId: id,
    accountLabel: profile.label,
    settings: saved,
  };
}

async function duplicateOpenRouterAccount(selection, apiKey) {
  if (!selection || selection.isNew !== true || !selection.profiles.length) return null;
  const creatorUserId = await creatorUserIdForApiKey(apiKey);
  if (!creatorUserId) return null;
  const existing = await findExistingOpenRouterAccount(selection.profiles, creatorUserId, {
    loadProfileSecrets: loadOpenRouterProfileSecrets,
  });
  return existing ? { profile: existing, creatorUserId } : null;
}

async function connectOpenRouterOAuth(options = {}) {
  const initialSettings = loadSettings();
  if (initialSettings.secureStorageAvailable !== true) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없어 OpenRouter 로그인을 저장할 수 없습니다.");
  }

  const selection = chooseOpenRouterProfile(initialSettings, options);
  const { verifier, challenge } = createPkceMaterial();
  const callback = await createLoopbackCallback();
  let profileSaved = false;
  try {
    const authorizationUrl = buildAuthorizationUrl(callback.callbackUrl, challenge);
    await shell.openExternal(authorizationUrl);
    const code = await callback.codePromise;
    const apiKey = await exchangeAuthorizationCode(code, verifier);

    // OAuth의 +계정은 실제 OpenRouter 사용자 단위로 중복을 막습니다.
    // 같은 계정의 여러 API Key를 의도적으로 추적하려면 수동 `API Key 추가`를 사용합니다.
    const duplicate = await duplicateOpenRouterAccount(selection, apiKey);
    if (duplicate) {
      return {
        ok: false,
        providerId: "openrouter",
        reason: "duplicate-account",
        error: `이미 등록된 OpenRouter 계정입니다 (${duplicate.profile.label || duplicate.profile.id}). 추가 계정으로 저장하지 않았습니다.`,
        profileId: duplicate.profile.id,
        accountLabel: duplicate.profile.label || duplicate.profile.id,
        accountId: duplicate.creatorUserId,
        duplicateAccount: true,
        needsRefresh: false,
      };
    }

    if (selection.isNew) {
      saveSettings({
        openRouterProfiles: [...selection.profiles, selection.profile],
        openRouterEnabled: true,
      });
      profileSaved = true;
    } else if (!initialSettings.openRouterEnabled) {
      saveSettings({ openRouterEnabled: true });
    }

    saveOpenRouterProfileSecrets(selection.profile.id, { apiKey });
    invalidateSecretStatusCache();
    await configure();
    return {
      ok: true,
      providerId: "openrouter",
      profileId: selection.profile.id,
      accountLabel: selection.profile.label,
      loginKind: "OpenRouter OAuth PKCE",
      needsRefresh: false,
    };
  } catch (err) {
    if (profileSaved) {
      try {
        saveSettings({ openRouterProfiles: selection.profiles });
      } catch {}
    }
    throw err;
  } finally {
    callback.close();
  }
}

ipcMain.handle("get-openrouter-router-status", () => router.status());
ipcMain.handle("configure-openrouter-router", () => configure());
ipcMain.handle("update-openrouter-router-metrics", (_event, rows) => {
  router.updateProfileMetrics(sanitizedMetrics(rows));
  return router.status();
});
ipcMain.handle("create-openrouter-tracked-profile", (_event, options) => createTrackedOpenRouterProfile(options || {}));
ipcMain.handle("delete-openrouter-profile", (_event, profileId) => deleteOpenRouterProfile(profileId));
ipcMain.handle("save-openrouter-profile-secrets", async (_event, profileId, patch) => {
  const settings = loadSettings();
  if (!profileExists(settings, profileId)) throw new Error("등록되지 않은 OpenRouter 프로필입니다.");
  saveOpenRouterProfileSecrets(profileId, patch || {});
  invalidateSecretStatusCache();
  await configure();
  return loadSettings();
});
ipcMain.handle("clear-openrouter-profile-secrets", async (_event, profileId) => {
  const settings = loadSettings();
  if (!profileExists(settings, profileId)) throw new Error("등록되지 않은 OpenRouter 프로필입니다.");
  clearOpenRouterProfileSecrets(profileId);
  invalidateSecretStatusCache();
  await configure();
  return loadSettings();
});
ipcMain.handle("copy-openrouter-router-token", () => {
  const token = ensureLocalRouterToken();
  invalidateSecretStatusCache();
  clipboard.writeText(token);
  return { ok: true };
});
ipcMain.handle("connect-openrouter-oauth", (_event, options) => connectOpenRouterOAuth(options || {}));

app.whenReady().then(() => configure()).catch(() => {});
app.on("before-quit", () => {
  router.stop().catch(() => {});
});

module.exports = {
  router,
  configure,
  profileExists,
  chooseOpenRouterProfile,
  sanitizedMetrics,
  secretEquals,
  findDuplicateApiKey,
  createTrackedOpenRouterProfile,
  deleteOpenRouterProfile,
  duplicateOpenRouterAccount,
  connectOpenRouterOAuth,
};
