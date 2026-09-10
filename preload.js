const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");
const { appData } = require("./lib/paths");
const { selectRoute, profileForSelection } = require("./lib/account-router");
const { normalizeAccountProfiles } = require("./lib/account-profiles");
const { normalizeOpenRouterProfiles } = require("./lib/openrouter-profiles");
const { apiProviderCatalog } = require("./lib/api-providers/registry");
const { launchRoutedCli, installRouterLaunchers } = require("./lib/routed-launcher");
const {
  launchLogin: launchAntigravityAccountLogin,
  removeAccount: removeAntigravityManagedAccount,
  managerStatus: getAntigravityManagerStatus,
  installManager: installAntigravityManager,
} = require("./lib/antigravity-account-manager");
const {
  PROFILE_LOGIN_PROVIDERS,
  launchCredentialLogin,
  nextManagedProfile,
  ensureProfileDirectory,
  findProfile,
} = require("./lib/credential-login");

let lastUsagePayload = null;
let usageDeliverySequence = 0;
let manualResizeActive = false;
let manualHeightLocked = false;
const usageListeners = new Set();

function hasManualHeight(settings) {
  return !!(settings && settings.manualWindowSize && Number.isFinite(Number(settings.manualWindowSize.height)));
}

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

async function deliverUsage(payload) {
  const sequence = ++usageDeliverySequence;
  let settings = payload && payload.settings ? payload.settings : {};
  try { settings = await ipcRenderer.invoke("get-settings"); } catch {}
  if (sequence !== usageDeliverySequence) return;
  const next = { ...(payload || {}), settings };
  lastUsagePayload = next;
  manualHeightLocked = hasManualHeight(settings);
  ipcRenderer.invoke("update-openrouter-router-metrics", openRouterMetrics(next)).catch(() => {});
  for (const listener of usageListeners) {
    try { listener(next); } catch {}
  }
}

ipcRenderer.on("usage", (_event, payload) => { deliverUsage(payload).catch(() => {}); });

function installRendererEnhancements() {
  if (document.querySelector('link[data-widget-enhancements="1"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "widget-enhancements.css";
  link.dataset.widgetEnhancements = "1";
  document.head.appendChild(link);
  const identityLink = document.createElement("link");
  identityLink.rel = "stylesheet";
  identityLink.href = "account-identity-ui.css";
  identityLink.dataset.widgetEnhancements = "1";
  document.head.appendChild(identityLink);
  for (const src of ["widget-enhancements.js", "account-identity-ui.js", "account-automation-v2.js", "openrouter-profile-ui.js"]) {
    const script = document.createElement("script");
    script.src = src;
    script.dataset.widgetEnhancements = "1";
    document.body.appendChild(script);
  }
}
window.addEventListener("DOMContentLoaded", installRendererEnhancements, { once: true });

async function getSettingsBridge() {
  const settings = await ipcRenderer.invoke("get-settings");
  manualHeightLocked = hasManualHeight(settings);
  return settings;
}
async function saveSettingsBridge(patch) {
  const settings = await ipcRenderer.invoke("save-settings", patch);
  manualHeightLocked = hasManualHeight(settings);
  return settings;
}

function freshUsagePayload(settings) {
  if (!lastUsagePayload || !Number.isFinite(Number(lastUsagePayload.fetchedAt))) return null;
  const refreshSeconds = Math.max(20, Number(settings && settings.refreshSeconds) || 60);
  const maxAgeMs = Math.max(120_000, refreshSeconds * 3_000);
  return Date.now() - Number(lastUsagePayload.fetchedAt) <= maxAgeMs ? lastUsagePayload : null;
}

async function routeLaunch(providerId) {
  await ipcRenderer.invoke("refresh");
  const settings = await getSettingsBridge();
  const payload = freshUsagePayload(settings);
  if (!payload) return { ok: false, providerId, reason: "usage-too-old" };
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
  return installRouterLaunchers({ stateDir, binDir: path.join(stateDir, "router-bin") });
}

function formatAccountProfilesForUi(profiles) {
  return normalizeAccountProfiles(profiles)
    .filter((profile) => profile.enabled !== false)
    .map((profile) => `${profile.providerId}|${profile.label}|${profile.configDir}`)
    .join("\n");
}
function disabledProviderSet(settings = {}) {
  return new Set((Array.isArray(settings.disabledCredentialProviders) ? settings.disabledCredentialProviders : [])
    .map((id) => String(id || "").toLowerCase()));
}
async function reenableDefaultCredential(providerId, settings) {
  const id = String(providerId || "").toLowerCase();
  const disabled = disabledProviderSet(settings);
  const before = disabled.size;
  disabled.delete(id);
  if (id === "cursor") disabled.delete("grokbot");
  if (disabled.size === before && !disabledProviderSet(settings).has(id)) return settings;
  return saveSettingsBridge({ disabledCredentialProviders: [...disabled] });
}

async function connectCredential(providerId, options = {}) {
  const id = String(providerId || "").toLowerCase();
  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", options || {});
  const settings = await getSettingsBridge();
  const profileId = String((options && options.profileId) || "");
  const profileProvider = id === "grokbot" ? "cursor" : id;
  const profile = profileId ? findProfile(settings, profileProvider, profileId) : null;
  const result = launchCredentialLogin(id, profile);
  if (result && result.ok && !profileId) {
    const nextSettings = await reenableDefaultCredential(id, settings);
    return { ...result, settings: nextSettings };
  }
  return result;
}

async function addCredentialAccount(providerId) {
  const id = String(providerId || "").toLowerCase();
  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", { createNew: true });
  if (id === "antigravity") return launchAntigravityAccountLogin();
  if (!PROFILE_LOGIN_PROVIDERS.has(id)) return { ok: false, providerId: id, reason: "profiles-not-supported" };
  const settings = await getSettingsBridge();
  const proposal = nextManagedProfile(settings, id);
  if (!proposal) return { ok: false, providerId: id, reason: "profiles-not-supported" };
  ensureProfileDirectory(proposal);
  const merged = [...normalizeAccountProfiles(settings.accountProfiles), proposal];
  const saved = await saveSettingsBridge({ accountProfiles: merged });
  const profile = normalizeAccountProfiles(saved.accountProfiles)
    .find((item) => item.providerId === id && item.configDir === proposal.configDir);
  if (!profile) return { ok: false, providerId: id, reason: "profile-save-failed" };
  const result = launchCredentialLogin(id, profile);
  return { ...result, accountProfilesText: formatAccountProfilesForUi(saved.accountProfiles) };
}

function managedAntigravityRow(profileId) {
  const rows = Array.isArray(lastUsagePayload && lastUsagePayload.providers) ? lastUsagePayload.providers : [];
  return rows.find((row) => row && row.providerId === "antigravity"
    && row.profileId === profileId && row.managedBy === "agm" && row.externalAccountRef);
}

async function disconnectCredential(providerId, options = {}) {
  const id = String(providerId || "").toLowerCase();
  const profileId = String((options && options.profileId) || "");
  const settings = await getSettingsBridge();

  if (id === "openrouter") {
    const profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
    const targets = profileId ? profiles.filter((profile) => profile.id === profileId) : profiles;
    if (!targets.length) return { ok: false, providerId: id, reason: "profile-not-found" };
    for (const profile of targets) await ipcRenderer.invoke("clear-openrouter-profile-secrets", profile.id);
    const removed = new Set(targets.map((profile) => profile.id));
    const remaining = profiles.filter((profile) => !removed.has(profile.id));
    const saved = await saveSettingsBridge({ openRouterProfiles: remaining, openRouterEnabled: remaining.length > 0 });
    return { ok: true, providerId: id, profileId: profileId || null, settings: saved };
  }

  if (id === "antigravity" && profileId) {
    const row = managedAntigravityRow(profileId);
    if (row) {
      const removed = await removeAntigravityManagedAccount(row.externalAccountRef);
      return removed.ok
        ? { ok: true, providerId: id, profileId, managedBy: "agm", settings }
        : { ...removed, providerId: id, profileId };
    }
  }

  if (profileId) {
    const profiles = normalizeAccountProfiles(settings.accountProfiles);
    const profileProviderId = id === "grokbot" ? "cursor" : id;
    const exists = profiles.some((profile) => profile.providerId === profileProviderId && profile.id === profileId);
    if (!exists) return { ok: false, providerId: id, profileId, reason: "profile-not-found" };
    const remaining = profiles.filter((profile) => !(profile.providerId === profileProviderId && profile.id === profileId));
    const saved = await saveSettingsBridge({ accountProfiles: remaining });
    return {
      ok: true,
      providerId: id,
      profileId,
      sharedCredentialProvider: profileProviderId !== id ? profileProviderId : null,
      settings: saved,
      accountProfilesText: formatAccountProfilesForUi(saved.accountProfiles),
    };
  }

  const supported = new Set(["codex", "claude", "grok", "cursor", "grokbot", "copilot", "antigravity"]);
  if (!supported.has(id)) return { ok: false, providerId: id, reason: "unsupported-provider" };
  const disabled = disabledProviderSet(settings);
  disabled.add(id);
  if (id === "cursor") disabled.add("grokbot");
  const saved = await saveSettingsBridge({ disabledCredentialProviders: [...disabled] });
  return { ok: true, providerId: id, settings: saved };
}

async function manualWindowResize(payload = {}) {
  const phase = String(payload.phase || "").toLowerCase();
  if (phase === "start") manualResizeActive = true;
  try {
    const result = await ipcRenderer.invoke("manual-window-resize", payload);
    if (result && result.manualWindowSize) manualHeightLocked = Number.isFinite(Number(result.manualWindowSize.height));
    if (result && result.settings) manualHeightLocked = hasManualHeight(result.settings);
    return result;
  } finally {
    if (phase === "end" || phase === "cancel") manualResizeActive = false;
  }
}
function contentDrivenResize(height) {
  if (manualResizeActive || manualHeightLocked) return Promise.resolve({ skipped: true, reason: "manual-height" });
  return ipcRenderer.invoke("resize", height);
}

contextBridge.exposeInMainWorld("tokenWidget", {
  onUsage: (cb) => { usageListeners.add(cb); return () => usageListeners.delete(cb); },
  getLastUsage: () => lastUsagePayload,
  refresh: () => ipcRenderer.invoke("refresh"),
  getSettings: getSettingsBridge,
  saveSettings: saveSettingsBridge,
  getOpenRouterRouterStatus: () => ipcRenderer.invoke("get-openrouter-router-status"),
  configureOpenRouterRouter: () => ipcRenderer.invoke("configure-openrouter-router"),
  createOpenRouterTrackedProfile: (options) => ipcRenderer.invoke("create-openrouter-tracked-profile", options || {}),
  deleteOpenRouterProfile: (profileId) => ipcRenderer.invoke("delete-openrouter-profile", profileId),
  saveOpenRouterProfileSecrets: (profileId, patch) => ipcRenderer.invoke("save-openrouter-profile-secrets", profileId, patch),
  clearOpenRouterProfileSecrets: (profileId) => ipcRenderer.invoke("clear-openrouter-profile-secrets", profileId),
  copyOpenRouterRouterToken: () => ipcRenderer.invoke("copy-openrouter-router-token"),
  connectCredential,
  addCredentialAccount,
  disconnectCredential,
  getAntigravityAccountManagerStatus: () => getAntigravityManagerStatus(),
  installAntigravityAccountManager: () => installAntigravityManager(),
  getCliVersions: (options) => ipcRenderer.invoke("get-cli-versions", options || {}),
  updateCli: (providerId) => ipcRenderer.invoke("update-cli", providerId),
  getApiProviderCatalog: () => apiProviderCatalog(),
  saveApiProviderSecret: (providerId, patch) => ipcRenderer.invoke("save-api-provider-secret", providerId, patch || {}),
  clearApiProviderSecret: (providerId) => ipcRenderer.invoke("clear-api-provider-secret", providerId),
  routeLaunch,
  installSmartRoutingLaunchers,
  manualWindowResize,
  hide: () => ipcRenderer.invoke("hide"),
  quit: () => ipcRenderer.invoke("quit"),
  resize: contentDrivenResize,
});
