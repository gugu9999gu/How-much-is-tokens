const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");
const { appData } = require("./lib/paths");
const { selectRoute, profileForSelection } = require("./lib/account-router");
const { launchRoutedCli, installRouterLaunchers } = require("./lib/routed-launcher");

let lastUsagePayload = null;
const usageListeners = new Set();

ipcRenderer.on("usage", (_event, payload) => {
  lastUsagePayload = payload;
  for (const listener of usageListeners) {
    try { listener(payload); } catch {}
  }
});

async function routeLaunch(providerId) {
  await ipcRenderer.invoke("refresh");
  const settings = await ipcRenderer.invoke("get-settings");
  const providers = lastUsagePayload && Array.isArray(lastUsagePayload.providers)
    ? lastUsagePayload.providers
    : [];
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
  routeLaunch,
  installSmartRoutingLaunchers,
  hide: () => ipcRenderer.invoke("hide"),
  quit: () => ipcRenderer.invoke("quit"),
  resize: (height) => ipcRenderer.invoke("resize", height),
});
