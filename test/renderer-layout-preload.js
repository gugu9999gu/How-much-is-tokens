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
  resetDisplayMode: "auto",
  opacity: 0.94,
  refreshSeconds: 60,
  manualWindowSize: null,
  disabledCredentialProviders: [],
  githubToken: "",
  cursorCookie: "",
  accountProfiles: [
    { id: "codex-profile-2", providerId: "codex", label: "Codex 2", configDir: "C:\\AI-Profiles\\codex-2", enabled: true },
  ],
  codexAutoUseReset: false,
  codexAutoResetProfiles: [],
  smartRouting: {},
  openRouterEnabled: false,
  openRouterProfiles: [],
  openRouterProfileStatuses: [],
  openRouterRouter: { enabled: false, port: 43123, policy: "priority-fallback" },
  openRouterLocalRouterTokenConfigured: false,
  apiProviderStatuses: { falai: { apiKey: true }, magnific: { apiKey: true } },
  secureStorageAvailable: true,
};

const API_PROVIDER_CATALOG = [
  { id: "falai", name: "fal.ai", detail: "계정 크레딧 잔액", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key", placeholder: "fal API Key (Admin scope)" }] },
  { id: "higgsfield", name: "Higgsfield", detail: "크레딧 (공개 잔액 API 제한적)", vendor: "생성형 미디어", credentials: [{ key: "keyId", label: "API Key ID", placeholder: "HF_API_KEY_ID" }, { key: "keySecret", label: "API Key Secret", placeholder: "HF_API_KEY_SECRET" }] },
  { id: "magnific", name: "Magnific", detail: "최근 생성 / 사용 현황", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key", placeholder: "x-magnific-api-key" }] },
  { id: "elevenlabs", name: "ElevenLabs", detail: "월간 문자 사용량", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key", placeholder: "xi-api-key" }] },
  { id: "stability", name: "Stability AI", detail: "크레딧 잔액", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }] },
];

let lastPayload = {
  fetchedAt: Date.now(),
  providers: [
    {
      id: "codex", providerId: "codex", name: "Codex", status: "ok", remainingPct: 75,
      resetAt: Date.now() + 60 * 60 * 1000,
      accountEmail: "codex@example.com", accountLogin: "codex-user", accountId: "acct_codex_123",
    },
    { id: "claude", providerId: "claude", name: "Claude", status: "missing" },
    { id: "grok", providerId: "grok", name: "Grok", status: "missing" },
    { id: "cursor", providerId: "cursor", name: "Cursor", status: "missing" },
    { id: "grokbot", providerId: "grokbot", name: "Grok Bot", status: "missing" },
    { id: "copilot", providerId: "copilot", name: "Copilot", status: "missing" },
    { id: "antigravity", providerId: "antigravity", name: "Antigravity", status: "missing" },
    { id: "openrouter", providerId: "openrouter", name: "OpenRouter", status: "missing" },
    {
      id: "falai", providerId: "falai", name: "fal.ai", vendor: "생성형 미디어", status: "ok",
      creditBalances: [{ id: "credits", label: "계정 크레딧", balance: 42.5, currency: "USD" }],
    },
    {
      id: "elevenlabs", providerId: "elevenlabs", name: "ElevenLabs", vendor: "생성형 미디어", status: "ok",
      plan: "creator", remainingPct: 68,
      windows: [{ id: "characters", label: "문자 사용량", remainingPct: 68 }],
      creditBalances: [{ id: "characters", label: "문자", balance: 68000, used: 32000, limit: 100000, unit: "자", remainingPct: 68 }],
    },
    {
      id: "magnific", providerId: "magnific", name: "Magnific", vendor: "생성형 미디어", status: "ok",
      extras: [{ label: "최근 생성", value: "5건" }],
      logsTitle: "최근 생성",
      logs: [
        { label: "text-to-image", sub: "완료 · 5/1 12:30" },
        { label: "upscale", sub: "완료 · 5/1 11:02" },
      ],
    },
  ],
  settings: { ...settings },
};
const listeners = new Set();

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

function cliFixture() {
  return [
    { providerId: "codex", label: "Codex", installed: true, installedVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, updateSupported: true },
    { providerId: "claude", label: "Claude", installed: true, installedVersion: "2.0.0", latestVersion: "2.0.0", updateAvailable: false, updateSupported: true },
    { providerId: "grok", label: "Grok", installed: true, installedVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, updateSupported: true },
    { providerId: "cursor", label: "Cursor", installed: true, installedVersion: "2026.08.01-a", latestVersion: "2026.09.01-b", updateAvailable: true, updateSupported: true, autoUpdate: true },
    { providerId: "grokbot", label: "Grok Bot", installed: true, installedVersion: "2026.08.01-a", latestVersion: "2026.09.01-b", updateAvailable: true, updateSupported: true, autoUpdate: true },
    { providerId: "copilot", label: "Copilot / GitHub CLI", installed: true, installedVersion: "2.80.0", latestVersion: "2.90.0", updateAvailable: true, updateSupported: true },
    { providerId: "antigravity", label: "Antigravity", installed: true, installedVersion: "1.2.0", latestVersion: "1.3.0", updateAvailable: true, updateSupported: true, autoUpdate: true },
  ];
}

contextBridge.exposeInMainWorld("tokenWidget", {
  refresh: async () => emit(),
  hide: async () => {},
  quit: async () => {},
  resize: async (height) => ({ requestedHeight: height, height, constrained: false }),
  manualWindowResize: async (payload = {}) => ({ ok: true, phase: payload.phase, settings: { ...settings } }),
  getSettings: async () => ({ ...settings }),
  saveSettings: async (patch = {}) => ({ ...Object.assign(settings, patch) }),
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
  addCredentialAccount: async (providerId) => ({ ok: true, providerId, accountLabel: `${providerId} 2`, needsRefresh: true }),
  disconnectCredential: async (providerId) => ({ ok: true, providerId, settings: { ...settings } }),
  getAntigravityAccountManagerStatus: async () => ({ installed: true, ready: true, goAvailable: true }),
  installAntigravityAccountManager: async () => ({ ok: true, status: { installed: true, ready: true } }),
  getCliVersions: async () => cliFixture(),
  updateCli: async (providerId) => ({ ok: true, providerId, status: { providerId, installed: true, installedVersion: "latest" } }),
  getApiProviderCatalog: () => API_PROVIDER_CATALOG.map((provider) => ({ ...provider, credentials: provider.credentials.map((cred) => ({ ...cred })) })),
  saveApiProviderSecret: async (providerId, patch = {}) => {
    settings.apiProviderStatuses = { ...(settings.apiProviderStatuses || {}) };
    const fields = { ...(settings.apiProviderStatuses[providerId] || {}) };
    for (const key of Object.keys(patch)) if (String(patch[key] || "").trim()) fields[key] = true;
    settings.apiProviderStatuses[providerId] = fields;
    return { ...settings };
  },
  clearApiProviderSecret: async (providerId) => {
    settings.apiProviderStatuses = { ...(settings.apiProviderStatuses || {}) };
    delete settings.apiProviderStatuses[providerId];
    return { ...settings };
  },
  routeLaunch: async (providerId) => ({ ok: true, providerId, accountLabel: `${providerId} 2`, remainingPct: 55 }),
  installSmartRoutingLaunchers: async () => ({ ok: true, binDir: "C:\\router-bin" }),
  onUsage: (callback) => {
    listeners.add(callback);
    setTimeout(() => callback(lastPayload), 0);
    return () => listeners.delete(callback);
  },
});

window.addEventListener("DOMContentLoaded", () => {
  for (const href of ["widget-enhancements.css", "account-identity-ui.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
  for (const src of ["widget-enhancements.js", "account-identity-ui.js", "account-automation-v2.js"]) {
    const script = document.createElement("script");
    script.src = src;
    document.body.appendChild(script);
  }
}, { once: true });
