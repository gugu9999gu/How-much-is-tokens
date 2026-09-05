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
  openRouterEnabled: false,
  openRouterProfiles: [],
  openRouterProfileStatuses: [],
  openRouterRouter: { enabled: false, port: 43123, policy: "priority-fallback" },
  openRouterLocalRouterTokenConfigured: false,
  secureStorageAvailable: true,
};

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
  refresh: async () => {},
  hide: async () => {},
  quit: async () => {},
  resize: async (height) => ({ requestedHeight: height, height, constrained: false }),
  getSettings: async () => ({ ...settings }),
  saveSettings: async (patch = {}) => Object.assign(settings, patch),
  getOpenRouterRouterStatus: async () => routerStatus(),
  configureOpenRouterRouter: async () => routerStatus(),
  saveOpenRouterProfileSecrets: async () => ({ ...settings }),
  clearOpenRouterProfileSecrets: async () => ({ ...settings }),
  copyOpenRouterRouterToken: async () => {
    settings.openRouterLocalRouterTokenConfigured = true;
    return { ok: true };
  },
  routeLaunch: async (providerId) => ({ ok: false, providerId, reason: "disabled" }),
  installSmartRoutingLaunchers: async () => ({ ok: false, reason: "unsupported-platform" }),
  onUsage: (callback) => {
    setTimeout(() => callback({ fetchedAt: Date.now(), providers: [], settings: { ...settings } }), 0);
  },
});
