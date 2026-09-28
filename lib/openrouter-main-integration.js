const crypto = require("crypto");
const { app, clipboard, ipcMain, shell } = require("electron");
const { loadSettings, saveSettings, invalidateSecretStatusCache } = require("./settings");
const {
  MAX_PROFILES,
  cleanProfileId,
  normalizeOpenRouterProfiles,
  createOpenRouterProfile,
  selectOpenRouterLoginProfile,
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
  const selected = selectOpenRouterLoginProfile(settings.openRouterProfiles, options);
  if (selected.profile) return selected;
  const profile = createOpenRouterProfile(selected.profiles, {
    label: options && options.label,
  });
  if (!profile) throw new Error(`OpenRouter 프로필은 최대 ${MAX_PROFILES}개까지 등록할 수 있습니다.`);
  return { profile, profiles: selected.profiles, isNew: true };
}

function openRouterProfileForStorage(profile, creatorUserId) {
  const next = { ...profile, enabled: true };
  delete next.disabledAt;
  if (creatorUserId) next.accountId = creatorUserId;
  return next;
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

async function assignOpenRouterLogin(selection, apiKey) {
  const creatorUserId = await creatorUserIdForApiKey(apiKey);
  const existing = creatorUserId
    ? await findExistingOpenRouterAccount(selection.profiles, creatorUserId, {
      loadProfileSecrets: loadOpenRouterProfileSecrets,
      excludeProfileId: selection && selection.isNew ? null : selection.profile && selection.profile.id,
    })
    : null;
  const target = existing || (selection && selection.profile);
  return {
    target,
    creatorUserId,
    reused: !!existing || !!(selection && selection.resumed) || !!(target && target.enabled === false),
    createProfile: !!(selection && selection.isNew && !existing),
  };
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

    // 같은 OpenRouter 계정은 새 프로필을 만들지 않고 기존 프로필에 다시 넣습니다.
    // 같은 계정의 키를 여러 개 추적하려면 수동 API Key 추가를 사용합니다.
    const assignment = await assignOpenRouterLogin(selection, apiKey);
    const storedTarget = openRouterProfileForStorage(assignment.target, assignment.creatorUserId);
    const profiles = assignment.createProfile
      ? [...selection.profiles, storedTarget]
      : selection.profiles.map((profile) => profile.id === storedTarget.id ? storedTarget : profile);
    saveSettings({ openRouterProfiles: profiles, openRouterEnabled: true });
    profileSaved = assignment.createProfile;

    saveOpenRouterProfileSecrets(storedTarget.id, { apiKey });
    invalidateSecretStatusCache();
    await configure();
    return {
      ok: true,
      providerId: "openrouter",
      profileId: storedTarget.id,
      accountLabel: storedTarget.label,
      accountId: assignment.creatorUserId || storedTarget.accountId || null,
      reusedProfile: assignment.reused === true,
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
  assignOpenRouterLogin,
  connectOpenRouterOAuth,
};
