const path = require("path");
const { contextBridge, ipcRenderer, shell } = require("electron");
const { appData } = require("./lib/paths");
const { selectRoute, profileForSelection } = require("./lib/account-router");
const { normalizeAccountProfiles } = require("./lib/account-profiles");
const { normalizeOpenRouterProfiles } = require("./lib/openrouter-profiles");
const { launchRoutedCli, installRouterLaunchers } = require("./lib/routed-launcher");
const {
  PROFILE_LOGIN_PROVIDERS,
  launchCredentialLogin,
  nextManagedProfile,
  ensureProfileDirectory,
  findProfile,
} = require("./lib/credential-login");
const {
  createPkceMaterial,
  buildAuthorizationUrl,
  createLoopbackCallback,
  exchangeAuthorizationCode,
} = require("./lib/openrouter-oauth");

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

function formatAccountProfilesForUi(profiles) {
  return normalizeAccountProfiles(profiles)
    .filter((profile) => profile.enabled !== false)
    .map((profile) => `${profile.providerId}|${profile.label}|${profile.configDir}`)
    .join("\n");
}

async function connectOpenRouter(options = {}) {
  let settings = await ipcRenderer.invoke("get-settings");
  let profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
  const createNew = options && options.createNew === true;
  let profile = null;

  if (createNew || profiles.length === 0) {
    const ordinal = profiles.length + 1;
    let id = profiles.length === 0 ? "default" : `account-${ordinal}`;
    let suffix = ordinal;
    while (profiles.some((item) => item.id === id)) {
      suffix += 1;
      id = `account-${suffix}`;
    }
    profile = {
      id,
      label: `OpenRouter ${ordinal}`,
      priority: ordinal * 10,
      enabled: true,
    };
    settings = await ipcRenderer.invoke("save-settings", {
      openRouterProfiles: [...profiles, profile],
      openRouterEnabled: true,
    });
    profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
    profile = profiles.find((item) => item.id === id) || profile;
  } else {
    const requested = String((options && options.profileId) || "");
    profile = profiles.find((item) => item.id === requested) || profiles[0];
  }

  const { verifier, challenge } = createPkceMaterial();
  const callback = await createLoopbackCallback();
  try {
    const authorizationUrl = buildAuthorizationUrl(callback.callbackUrl, challenge);
    await shell.openExternal(authorizationUrl);
    const code = await callback.codePromise;
    const apiKey = await exchangeAuthorizationCode(code, verifier);
    await ipcRenderer.invoke("save-openrouter-profile-secrets", profile.id, { apiKey });
    await ipcRenderer.invoke("save-settings", { openRouterEnabled: true });
    await ipcRenderer.invoke("configure-openrouter-router");
    return {
      ok: true,
      providerId: "openrouter",
      profileId: profile.id,
      accountLabel: profile.label,
      loginKind: "OpenRouter OAuth PKCE",
      needsRefresh: false,
    };
  } finally {
    callback.close();
  }
}

async function connectCredential(providerId, options = {}) {
  const id = String(providerId || "").toLowerCase();
  if (id === "openrouter") return connectOpenRouter(options);
  const settings = await ipcRenderer.invoke("get-settings");
  const profileId = String((options && options.profileId) || "");
  const profile = profileId ? findProfile(settings, id, profileId) : null;
  return launchCredentialLogin(id, profile);
}

async function addCredentialAccount(providerId) {
  const id = String(providerId || "").toLowerCase();
  if (id === "openrouter") return connectOpenRouter({ createNew: true });
  if (!PROFILE_LOGIN_PROVIDERS.has(id)) {
    return { ok: false, providerId: id, reason: "profiles-not-supported" };
  }

  const settings = await ipcRenderer.invoke("get-settings");
  const proposal = nextManagedProfile(settings, id);
  if (!proposal) return { ok: false, providerId: id, reason: "profiles-not-supported" };
  ensureProfileDirectory(proposal);

  const merged = [...normalizeAccountProfiles(settings.accountProfiles), proposal];
  const saved = await ipcRenderer.invoke("save-settings", { accountProfiles: merged });
  const profile = normalizeAccountProfiles(saved.accountProfiles)
    .find((item) => item.providerId === id && item.configDir === proposal.configDir);
  if (!profile) return { ok: false, providerId: id, reason: "profile-save-failed" };

  const result = launchCredentialLogin(id, profile);
  return {
    ...result,
    accountProfilesText: formatAccountProfilesForUi(saved.accountProfiles),
  };
}

contextBridge.exposeInMainWorld("tokenWidget", {
  onUsage: (cb) => {
    usageListeners.add(cb);
    return () => usageListeners.delete(cb);
  },
  getLastUsage: () => lastUsagePayload,
  refresh: () => ipcRenderer.invoke("refresh"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (patch) => ipcRenderer.invoke("save-settings", patch),
  getOpenRouterRouterStatus: () => ipcRenderer.invoke("get-openrouter-router-status"),
  configureOpenRouterRouter: () => ipcRenderer.invoke("configure-openrouter-router"),
  saveOpenRouterProfileSecrets: (profileId, patch) => ipcRenderer.invoke("save-openrouter-profile-secrets", profileId, patch),
  clearOpenRouterProfileSecrets: (profileId) => ipcRenderer.invoke("clear-openrouter-profile-secrets", profileId),
  copyOpenRouterRouterToken: () => ipcRenderer.invoke("copy-openrouter-router-token"),
  connectCredential,
  addCredentialAccount,
  routeLaunch,
  installSmartRoutingLaunchers,
  hide: () => ipcRenderer.invoke("hide"),
  quit: () => ipcRenderer.invoke("quit"),
  resize: (height) => ipcRenderer.invoke("resize", height),
});

window.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector('script[data-connection-settings="true"]')) return;
  const script = document.createElement("script");
  script.src = "connection-settings.js";
  script.dataset.connectionSettings = "true";
  document.body.appendChild(script);
});