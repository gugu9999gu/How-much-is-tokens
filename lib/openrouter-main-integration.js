const { app, clipboard, ipcMain, shell } = require("electron");
const { loadSettings, saveSettings, invalidateSecretStatusCache } = require("./settings");
const { cleanProfileId, normalizeOpenRouterProfiles } = require("./openrouter-profiles");
const {
  saveOpenRouterProfileSecrets,
  clearOpenRouterProfileSecrets,
  ensureLocalRouterToken,
} = require("./secure-secrets");
const {
  createPkceMaterial,
  buildAuthorizationUrl,
  createLoopbackCallback,
  exchangeAuthorizationCode,
} = require("./openrouter-oauth");
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

  const ordinal = profiles.length + 1;
  let suffix = ordinal;
  let id = profiles.length === 0 ? "default" : `account-${suffix}`;
  while (profiles.some((item) => item.id === id)) {
    suffix += 1;
    id = `account-${suffix}`;
  }
  return {
    profile: {
      id,
      label: `OpenRouter ${ordinal}`,
      priority: ordinal * 10,
      enabled: true,
    },
    profiles,
    isNew: true,
  };
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
  connectOpenRouterOAuth,
};