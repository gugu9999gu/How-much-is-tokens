const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");
const { appData } = require("./lib/paths");
const { selectRoute, profileForSelection } = require("./lib/account-router");
const { launchRoutedCli, installRouterLaunchers } = require("./lib/routed-launcher");

let lastUsagePayload = null;
const usageListeners = new Set();

function openRouterMetrics(payload) {
  const providers = Array.isArray(payload && payload.providers) ? payload.providers : [];
  return providers
    .filter((provider) => provider && provider.providerId === "openrouter" && provider.profileId)
    .map((provider) => ({
      providerId: "openrouter",
      profileId: provider.profileId,
      remainingPct: provider.remainingPct,
      routingRemainingPct: provider.routingRemainingPct,
      status: provider.status,
    }));
}

ipcRenderer.on("usage", (_event, payload) => {
  lastUsagePayload = payload;
  ipcRenderer.invoke("update-openrouter-router-metrics", openRouterMetrics(payload)).catch(() => {});
  for (const listener of usageListeners) {
    try { listener(payload); } catch {}
  }
});

function freshUsagePayload(settings) {
  if (!lastUsagePayload || !Number.isFinite(Number(lastUsagePayload.fetchedAt))) return null;
  const refreshSeconds = Math.max(20, Number(settings && settings.refreshSeconds) || 60);
  const maxAgeMs = Math.max(120_000, refreshSeconds * 3_000);
  return Date.now() - Number(lastUsagePayload.fetchedAt) <= maxAgeMs ? lastUsagePayload : null;
}

async function routeLaunch(providerId) {
  await ipcRenderer.invoke("refresh");
  const settings = await ipcRenderer.invoke("get-settings");
  const payload = freshUsagePayload(settings);
  if (!payload) {
    return { ok: false, providerId, reason: "usage-too-old" };
  }
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const selection = selectRoute(providerId, providers, settings.smartRouting);
  if (!selection.ok) return selection;

  const profile = profileForSelection(settings, selection);
  const launched = launchRoutedCli(providerId, profile);
  return {
    ...launched,
    policy: selection.policy,
    routeReason: selection.reason,
    remainingPct: selection.remainingPct,
    accountLabel: selection.accountLabel,
  };
}

function installSmartRoutingLaunchers() {
  const stateDir = path.join(appData(), "how-much-is-tokens");
  return installRouterLaunchers({
    stateDir,
    binDir: path.join(stateDir, "router-bin"),
  });
}

contextBridge.exposeInMainWorld("tokenWidget", {
  onUsage: (cb) => {
    usageListeners.add(cb);
    return () => usageListeners.delete(cb);
  },
  refresh: () => ipcRenderer.invoke("refresh"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (patch) => ipcRenderer.invoke("save-settings", patch),
  getOpenRouterRouterStatus: () => ipcRenderer.invoke("get-openrouter-router-status"),
  configureOpenRouterRouter: () => ipcRenderer.invoke("configure-openrouter-router"),
  saveOpenRouterProfileSecrets: (profileId, patch) => ipcRenderer.invoke("save-openrouter-profile-secrets", profileId, patch),
  clearOpenRouterProfileSecrets: (profileId) => ipcRenderer.invoke("clear-openrouter-profile-secrets", profileId),
  copyOpenRouterRouterToken: () => ipcRenderer.invoke("copy-openrouter-router-token"),
  routeLaunch,
  installSmartRoutingLaunchers,
  hide: () => ipcRenderer.invoke("hide"),
  quit: () => ipcRenderer.invoke("quit"),
  resize: (height) => ipcRenderer.invoke("resize", height),
});
