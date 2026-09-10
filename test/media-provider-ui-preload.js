const { contextBridge } = require("electron");

const settings = {
  secureStorageAvailable: true,
  apiProviderStatuses: {},
  mediaProviderProfiles: [],
  mediaProviderProfileStatuses: [],
};
let providers = [];
const listeners = new Set();
const catalog = [
  { id: "falai", name: "fal.ai", detail: "계정 크레딧 잔액", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key", placeholder: "fal API Key" }], mcp: { available: true, url: "https://mcp.fal.ai/mcp", auth: "bearer-api-key", accountConnect: false } },
  { id: "higgsfield", name: "Higgsfield", detail: "크레딧 · 공식 MCP 지원", vendor: "생성형 미디어", credentials: [{ key: "keyId", label: "API Key ID" }, { key: "keySecret", label: "API Key Secret" }], mcp: { available: true, url: "https://mcp.higgsfield.ai/mcp", auth: "oauth", accountConnect: true } },
  { id: "stability", name: "Stability AI", detail: "크레딧 잔액", vendor: "생성형 미디어", credentials: [{ key: "apiKey", label: "API Key" }], mcp: { available: false } },
];

function clone() {
  return {
    ...settings,
    apiProviderStatuses: JSON.parse(JSON.stringify(settings.apiProviderStatuses)),
    mediaProviderProfiles: settings.mediaProviderProfiles.map((p) => ({ ...p })),
    mediaProviderProfileStatuses: settings.mediaProviderProfileStatuses.map((s) => ({ ...s, fields: { ...(s.fields || {}) } })),
  };
}
function emit() {
  const payload = { fetchedAt: Date.now(), providers: providers.map((p) => ({ ...p })), settings: clone() };
  listeners.forEach((cb) => setTimeout(() => cb(payload), 0));
}
function addProfile(providerId, label, mode, fields = {}) {
  const ordinal = settings.mediaProviderProfiles.filter((p) => p.providerId === providerId).length + 2;
  const id = `${providerId}-${ordinal}`;
  const profile = { id, providerId, label: label || `${providerId} ${ordinal}`, mode, priority: ordinal * 10, enabled: true };
  settings.mediaProviderProfiles.push(profile);
  settings.mediaProviderProfileStatuses.push({ id, providerId, mode, fields: { ...fields }, mcpAuthorized: mode === "mcp" && providerId === "higgsfield" });
  providers.push({ id: `${providerId}:media:${id}`, providerId, profileId: id, accountLabel: profile.label, status: "ok", remainingPct: 64, creditBalances: [{ id: "credits", label: "크레딧", balance: 64, unit: "크레딧" }] });
  emit();
  return profile;
}

contextBridge.exposeInMainWorld("tokenWidget", {
  getApiProviderCatalog: () => catalog.map((p) => ({ ...p, credentials: p.credentials.map((c) => ({ ...c })), mcp: { ...p.mcp } })),
  getSettings: async () => clone(),
  getLastUsage: () => ({ fetchedAt: Date.now(), providers: providers.map((p) => ({ ...p })), settings: clone() }),
  refresh: async () => emit(),
  onUsage: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  saveApiProviderSecret: async (providerId, patch) => {
    settings.apiProviderStatuses[providerId] = Object.fromEntries(Object.keys(patch || {}).map((key) => [key, true]));
    return clone();
  },
  clearApiProviderSecret: async (providerId) => { delete settings.apiProviderStatuses[providerId]; return clone(); },
  addMediaProviderAccount: async (providerId, options = {}) => {
    const fields = Object.fromEntries(Object.keys(options.credentials || {}).map((key) => [key, true]));
    const profile = addProfile(providerId, options.label, options.mode || "api", fields);
    return { ok: true, providerId, profileId: profile.id, accountLabel: profile.label, settings: clone() };
  },
  connectMediaProviderMcp: async (providerId, options = {}) => {
    if (options.createNew === false) return { ok: true, providerId, profileId: options.profileId, settings: clone() };
    const profile = addProfile(providerId, options.label || "Higgs MCP", "mcp", { oauthTokens: true });
    return { ok: true, providerId, profileId: profile.id, accountLabel: profile.label, settings: clone() };
  },
  updateMediaProviderAccount: async (providerId, profileId, patch = {}) => {
    const profile = settings.mediaProviderProfiles.find((p) => p.providerId === providerId && p.id === profileId);
    if (!profile) return { ok: false, reason: "profile-not-found" };
    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) profile.enabled = patch.enabled !== false;
    if (patch.label) profile.label = patch.label;
    return { ok: true, settings: clone() };
  },
  saveMediaProviderAccountCredentials: async (providerId, profileId, patch = {}) => {
    const status = settings.mediaProviderProfileStatuses.find((s) => s.providerId === providerId && s.id === profileId);
    if (status) Object.keys(patch).forEach((key) => { status.fields[key] = true; });
    return { ok: true, settings: clone() };
  },
  removeMediaProviderAccount: async (providerId, profileId) => {
    settings.mediaProviderProfiles = settings.mediaProviderProfiles.filter((p) => !(p.providerId === providerId && p.id === profileId));
    settings.mediaProviderProfileStatuses = settings.mediaProviderProfileStatuses.filter((s) => !(s.providerId === providerId && s.id === profileId));
    providers = providers.filter((p) => !(p.providerId === providerId && p.profileId === profileId));
    emit();
    return { ok: true, settings: clone() };
  },
});
