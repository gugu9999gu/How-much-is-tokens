const { app, clipboard, ipcMain } = require("electron");
const { loadSettings, invalidateSecretStatusCache } = require("./settings");
const { cleanProfileId, normalizeOpenRouterProfiles } = require("./openrouter-profiles");
const {
  saveOpenRouterProfileSecrets,
  clearOpenRouterProfileSecrets,
  ensureLocalRouterToken,
} = require("./secure-secrets");
const { OpenRouterRequestRouter } = require("./openrouter-request-router");

const router = new OpenRouterRequestRouter();

function profileExists(settings, profileId) {
  const id = cleanProfileId(profileId);
  return !!id && normalizeOpenRouterProfiles(settings.openRouterProfiles).some((profile) => profile.id === id);
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

app.whenReady().then(() => configure()).catch(() => {});
app.on("before-quit", () => {
  router.stop().catch(() => {});
});

module.exports = {
  router,
  configure,
  profileExists,
  sanitizedMetrics,
};
