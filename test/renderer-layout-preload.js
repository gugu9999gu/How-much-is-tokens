const { contextBridge } = require("electron");

const settings = {
  alwaysOnTop: false,
  compact: false,
  denseLayout: false,
  tokenAreaMaxHeight: 0,
  edgeDockEnabled: false,
  edgeDockSide: "top",
  openAtLogin: false,
  hideMissing: true,
  visualization: "ring",
  opacity: 0.94,
  refreshSeconds: 60,
  githubToken: "",
  cursorCookie: "",
  accountProfiles: [],
  smartRouting: {},
  openRouterEnabled: false,
  openRouterProfiles: [],
  openRouterProfileStatuses: [],
  openRouterRouter: { enabled: false, port: 43123, policy: "priority-fallback" },
  openRouterLocalRouterTokenConfigured: false,
  secureStorageAvailable: true,
};

let lastPayload = {
  fetchedAt: Date.now(),
  providers: [
    { id: "codex", providerId: "codex", name: "Codex", status: "ok", remainingPct: 75 },
    { id: "claude", providerId: "claude", name: "Claude", status: "missing" },
    { id: "grok", providerId: "grok", name: "Grok", status: "missing" },
    { id: "cursor", providerId: "cursor", name: "Cursor", status: "missing" },
    { id: "grokbot", providerId: "grokbot", name: "Grok Bot", status: "missing" },
    { id: "copilot", providerId: "copilot", name: "Copilot", status: "missing" },
    { id: "antigravity", providerId: "antigravity", name: "Antigravity", status: "missing" },
    { id: "openrouter", providerId: "openrouter", name: "OpenRouter", status: "missing" },
  ],
  settings: { ...settings },
};
const listeners = new Set();
const oauthAccounts = {
  codex: [
    { providerId: "codex", slotId: "fixture-codex-1", label: "d***r@example.com", active: true, needsReauth: false, expiresAt: Date.now() + 3600000, hasRefresh: true },
    { providerId: "codex", slotId: "fixture-codex-2", label: "w***k@example.com", active: false, needsReauth: false, expiresAt: Date.now() + 7200000, hasRefresh: true },
  ],
  cursor: [
    { providerId: "cursor", slotId: "fixture-cursor-1", label: "c***r@example.com", active: true, needsReauth: false, expiresAt: Date.now() + 3600000, hasRefresh: true },
  ],
};

function emit() {
  lastPayload = { ...lastPayload, fetchedAt: Date.now(), settings: { ...settings } };
  for (const callback of listeners) setTimeout(() => callback(lastPayload), 0);
}

function routerStatus() {
  return {
    enabled: settings.openRouterRouter.enabled === true,
    running: false,
    host: "127.0.0.1",
    port: settings.openRouterRouter.port || 43123,
    endpoint: `http://127.0.0.1:${settings.openRouterRouter.port || 43123}/v1`,
    policy: settings.openRouterRouter.policy || "priority-fallback",
    tokenConfigured: settings.openRouterLocalRouterTokenConfigured === true,
    profiles: settings.openRouterProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      priority: profile.priority,
      apiKeyConfigured: false,
      cooldownUntil: null,
      remainingPct: null,
    })),
    lastError: null,
  };
}

contextBridge.exposeInMainWorld("tokenWidget", {
  refresh: async () => emit(),
  hide: async () => {},
  quit: async () => {},
  resize: async (height) => ({ requestedHeight: height, height, constrained: false }),
  getSettings: async () => ({ ...settings }),
  saveSettings: async (patch = {}) => Object.assign(settings, patch),
  getLastUsage: () => lastPayload,
  getOpenRouterRouterStatus: async () => routerStatus(),
  configureOpenRouterRouter: async () => routerStatus(),
  saveOpenRouterProfileSecrets: async () => ({ ...settings }),
  clearOpenRouterProfileSecrets: async () => ({ ...settings }),
  copyOpenRouterRouterToken: async () => {
    settings.openRouterLocalRouterTokenConfigured = true;
    return { ok: true };
  },
  connectCredential: async (providerId) => ({ ok: false, providerId, reason: "cli-not-found", commands: [providerId] }),
  addCredentialAccount: async (providerId) => ({ ok: false, providerId, reason: "profiles-not-supported" }),
  listProviderAccounts: async (providerId) => (oauthAccounts[providerId] || []).map((row) => ({ ...row })),
  useProviderAccount: async (providerId, slotId) => {
    const rows = oauthAccounts[providerId] || [];
    rows.forEach((row) => { row.active = row.slotId === slotId; });
    return rows.map((row) => ({ ...row }));
  },
  reauthProviderAccount: async (providerId, slotId) => ({ ok: true, providerId, slotId, accounts: (oauthAccounts[providerId] || []).map((row) => ({ ...row })) }),
  removeProviderAccount: async (providerId, slotId) => {
    oauthAccounts[providerId] = (oauthAccounts[providerId] || []).filter((row) => row.slotId !== slotId);
    if (oauthAccounts[providerId].length && !oauthAccounts[providerId].some((row) => row.active)) oauthAccounts[providerId][0].active = true;
    return oauthAccounts[providerId].map((row) => ({ ...row }));
  },
  routeLaunch: async (providerId) => ({ ok: false, providerId, reason: "disabled" }),
  installSmartRoutingLaunchers: async () => ({ ok: false, reason: "unsupported-platform" }),
  onUsage: (callback) => {
    listeners.add(callback);
    setTimeout(() => callback(lastPayload), 0);
    return () => listeners.delete(callback);
  },
});