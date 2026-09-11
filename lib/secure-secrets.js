const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { readJson, writeJson } = require("./paths");
const { cleanProfileId, normalizeOpenRouterProfiles } = require("./openrouter-profiles");
const {
  cleanMediaProviderId,
  cleanMediaProfileId,
  normalizeMediaProviderProfiles,
} = require("./media-provider-profiles");

const STORE_VERSION = 1;
const LEGACY_API_KEY = "openrouterApiKey";
const LEGACY_MANAGEMENT_KEY = "openrouterManagementKey";
const LOCAL_ROUTER_TOKEN = "openrouterLocalRouterToken";
const ALLOWED_SECRETS = new Set([
  LEGACY_API_KEY,
  LEGACY_MANAGEMENT_KEY,
  LOCAL_ROUTER_TOKEN,
]);
const PROFILE_SECRET_RE = /^openrouterProfile:([a-z0-9][a-z0-9_-]{0,31}):(apiKey|managementKey)$/;
// Generic API-provider credentials (fal.ai, Higgsfield, Magnific, ...): the
// name is namespaced by a lowercase provider id and a credential field. Values
// are encrypted with the same OS-backed store as the OpenRouter secrets and are
// never written to settings.json.
const API_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const API_PROVIDER_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const API_PROVIDER_SECRET_RE = /^apiProvider:([a-z0-9][a-z0-9-]{0,31}):([a-zA-Z][a-zA-Z0-9_]{0,63})$/;
const MEDIA_PROFILE_SECRET_RE = /^mediaProfile:([a-z0-9][a-z0-9-]{0,31}):([a-z0-9][a-z0-9_-]{0,47}):([a-zA-Z][a-zA-Z0-9_]{0,63})$/;
const MCP_SECRET_FIELDS = Object.freeze([
  "oauthTokens",
  "oauthClientInformation",
  "oauthCodeVerifier",
  "oauthDiscovery",
]);

function cleanApiProviderId(id) {
  const value = String(id == null ? "" : id).trim().toLowerCase();
  return API_PROVIDER_ID_RE.test(value) ? value : null;
}

function apiProviderSecretName(providerId, field) {
  const id = cleanApiProviderId(providerId);
  if (!id) throw new Error("Invalid API provider id");
  if (!API_PROVIDER_FIELD_RE.test(String(field == null ? "" : field))) {
    throw new Error("Invalid API provider secret field");
  }
  return `apiProvider:${id}:${field}`;
}

function mediaProfileSecretName(providerId, profileId, field) {
  const provider = cleanMediaProviderId(providerId);
  const profile = cleanMediaProfileId(profileId);
  const secretField = String(field == null ? "" : field);
  if (!provider || !profile || !API_PROVIDER_FIELD_RE.test(secretField)) {
    throw new Error("Invalid media profile secret selector");
  }
  return `mediaProfile:${provider}:${profile}:${secretField}`;
}

function secretsPath() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function encryptionAvailable() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readStore() {
  const data = readJson(secretsPath());
  if (!data || data.version !== STORE_VERSION || !data.values || typeof data.values !== "object") {
    return { version: STORE_VERSION, values: {} };
  }
  return data;
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
  writeJson(secretsPath(), store);
}

function profileSecretName(profileId, kind) {
  const id = cleanProfileId(profileId);
  if (!id || !["apiKey", "managementKey"].includes(kind)) {
    throw new Error("Invalid OpenRouter profile secret selector");
  }
  return `openrouterProfile:${id}:${kind}`;
}

function canonicalSecretName(name) {
  if (name === LEGACY_API_KEY) return profileSecretName("default", "apiKey");
  if (name === LEGACY_MANAGEMENT_KEY) return profileSecretName("default", "managementKey");
  if (name === LOCAL_ROUTER_TOKEN) return name;
  const match = PROFILE_SECRET_RE.exec(String(name || ""));
  if (match && cleanProfileId(match[1])) return name;
  if (API_PROVIDER_SECRET_RE.test(String(name || ""))) return name;
  const media = MEDIA_PROFILE_SECRET_RE.exec(String(name || ""));
  if (media && cleanMediaProviderId(media[1]) && cleanMediaProfileId(media[2])) return name;
  throw new Error(`Unsupported secret: ${name}`);
}

function assertAllowed(name) {
  canonicalSecretName(name);
}

function decryptSecret(encoded) {
  if (!encoded || !encryptionAvailable()) return null;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(String(encoded), "base64"));
    return decrypted || null;
  } catch {
    return null;
  }
}

function legacyPhysicalName(name) {
  if (name === LEGACY_API_KEY) return LEGACY_API_KEY;
  if (name === LEGACY_MANAGEMENT_KEY) return LEGACY_MANAGEMENT_KEY;
  return null;
}

function getSecret(name) {
  assertAllowed(name);
  const store = readStore();
  const canonical = canonicalSecretName(name);
  let encoded = store.values[canonical];
  if (!encoded) {
    const legacy = legacyPhysicalName(name);
    if (legacy) encoded = store.values[legacy];
  }
  return decryptSecret(encoded);
}

function saveSecrets(patch = {}) {
  if (!encryptionAvailable()) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없습니다. 키는 평문으로 저장하지 않습니다.");
  }

  const store = readStore();
  let changed = false;
  for (const [name, rawValue] of Object.entries(patch || {})) {
    const canonical = canonicalSecretName(name);
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) continue;
    store.values[canonical] = safeStorage.encryptString(value).toString("base64");
    const legacy = legacyPhysicalName(name);
    if (legacy && Object.prototype.hasOwnProperty.call(store.values, legacy)) delete store.values[legacy];
    changed = true;
  }

  if (changed) writeStore(store);
  return secretStatus();
}

function clearSecrets(names = []) {
  const requested = Array.isArray(names) ? names : [names];
  const store = readStore();
  let changed = false;

  for (const name of requested) {
    assertAllowed(name);
    const canonical = canonicalSecretName(name);
    if (Object.prototype.hasOwnProperty.call(store.values, canonical)) {
      delete store.values[canonical];
      changed = true;
    }
    const legacy = legacyPhysicalName(name);
    if (legacy && Object.prototype.hasOwnProperty.call(store.values, legacy)) {
      delete store.values[legacy];
      changed = true;
    }
  }

  if (changed) writeStore(store);
  return secretStatus();
}

function loadOpenRouterProfileSecrets(profileId) {
  const id = cleanProfileId(profileId);
  if (!id) return { apiKey: null, managementKey: null };
  return {
    apiKey: getSecret(profileSecretName(id, "apiKey")),
    managementKey: getSecret(profileSecretName(id, "managementKey")),
  };
}

function saveOpenRouterProfileSecrets(profileId, patch = {}) {
  const id = cleanProfileId(profileId);
  if (!id) throw new Error("Invalid OpenRouter profile id");
  const secretPatch = {};
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    secretPatch[profileSecretName(id, "apiKey")] = patch.apiKey.trim();
  }
  if (typeof patch.managementKey === "string" && patch.managementKey.trim()) {
    secretPatch[profileSecretName(id, "managementKey")] = patch.managementKey.trim();
  }
  if (!Object.keys(secretPatch).length) return secretStatus();
  return saveSecrets(secretPatch);
}

function clearOpenRouterProfileSecrets(profileId) {
  const id = cleanProfileId(profileId);
  if (!id) throw new Error("Invalid OpenRouter profile id");
  return clearSecrets([
    profileSecretName(id, "apiKey"),
    profileSecretName(id, "managementKey"),
  ]);
}

function clearAllOpenRouterProfileSecrets() {
  const store = readStore();
  let changed = false;
  for (const name of Object.keys(store.values)) {
    if (PROFILE_SECRET_RE.test(name) || name === LEGACY_API_KEY || name === LEGACY_MANAGEMENT_KEY) {
      delete store.values[name];
      changed = true;
    }
  }
  if (changed) writeStore(store);
  return secretStatus();
}

function pruneOpenRouterProfileSecrets(profileIds = []) {
  const allowed = new Set(profileIds.map(cleanProfileId).filter(Boolean));
  const store = readStore();
  let changed = false;
  for (const name of Object.keys(store.values)) {
    const match = PROFILE_SECRET_RE.exec(name);
    if (match && !allowed.has(match[1])) {
      delete store.values[name];
      changed = true;
    }
  }
  if (changed) writeStore(store);
  return changed;
}

function migrateLegacyOpenRouterSecrets(profileId = "default") {
  const id = cleanProfileId(profileId);
  if (!id) throw new Error("Invalid OpenRouter migration profile id");
  const store = readStore();
  const apiTarget = profileSecretName(id, "apiKey");
  const managementTarget = profileSecretName(id, "managementKey");
  const hadApiKey = !!store.values[LEGACY_API_KEY];
  const hadManagementKey = !!store.values[LEGACY_MANAGEMENT_KEY];
  let changed = false;

  if (hadApiKey) {
    if (!store.values[apiTarget]) store.values[apiTarget] = store.values[LEGACY_API_KEY];
    delete store.values[LEGACY_API_KEY];
    changed = true;
  }
  if (hadManagementKey) {
    if (!store.values[managementTarget]) store.values[managementTarget] = store.values[LEGACY_MANAGEMENT_KEY];
    delete store.values[LEGACY_MANAGEMENT_KEY];
    changed = true;
  }
  if (changed) writeStore(store);
  return { changed, hadLegacy: hadApiKey || hadManagementKey, hadApiKey, hadManagementKey };
}

function loadApiProviderSecrets(providerId, fields = []) {
  const id = cleanApiProviderId(providerId);
  const out = {};
  if (!id) return out;
  for (const field of Array.isArray(fields) ? fields : []) {
    try {
      out[field] = getSecret(apiProviderSecretName(id, field));
    } catch {
      out[field] = null;
    }
  }
  return out;
}

function saveApiProviderSecrets(providerId, patch = {}) {
  const id = cleanApiProviderId(providerId);
  if (!id) throw new Error("Invalid API provider id");
  const secretPatch = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (typeof value === "string" && value.trim()) {
      secretPatch[apiProviderSecretName(id, field)] = value.trim();
    }
  }
  if (!Object.keys(secretPatch).length) return secretStatus();
  return saveSecrets(secretPatch);
}

function clearApiProviderSecrets(providerId, fields = []) {
  const id = cleanApiProviderId(providerId);
  if (!id) throw new Error("Invalid API provider id");
  const names = (Array.isArray(fields) ? fields : []).map((field) => apiProviderSecretName(id, field));
  if (!names.length) return secretStatus();
  return clearSecrets(names);
}

function loadMediaProviderProfileSecrets(providerId, profileId, fields = []) {
  const out = {};
  if (!cleanMediaProviderId(providerId) || !cleanMediaProfileId(profileId)) return out;
  for (const field of Array.isArray(fields) ? fields : []) {
    try {
      out[field] = getSecret(mediaProfileSecretName(providerId, profileId, field));
    } catch {
      out[field] = null;
    }
  }
  return out;
}

function saveMediaProviderProfileSecrets(providerId, profileId, patch = {}) {
  if (!cleanMediaProviderId(providerId) || !cleanMediaProfileId(profileId)) {
    throw new Error("Invalid media profile selector");
  }
  const secretPatch = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (typeof value === "string" && value.trim()) {
      secretPatch[mediaProfileSecretName(providerId, profileId, field)] = value.trim();
    }
  }
  if (!Object.keys(secretPatch).length) return secretStatus();
  return saveSecrets(secretPatch);
}

function clearMediaProviderProfileSecrets(providerId, profileId, fields = null) {
  const provider = cleanMediaProviderId(providerId);
  const profile = cleanMediaProfileId(profileId);
  if (!provider || !profile) throw new Error("Invalid media profile selector");
  if (Array.isArray(fields) && fields.length) {
    return clearSecrets(fields.map((field) => mediaProfileSecretName(provider, profile, field)));
  }
  const store = readStore();
  let changed = false;
  for (const name of Object.keys(store.values || {})) {
    const match = MEDIA_PROFILE_SECRET_RE.exec(name);
    if (match && match[1] === provider && match[2] === profile) {
      delete store.values[name];
      changed = true;
    }
  }
  if (changed) writeStore(store);
  return secretStatus();
}

function pruneMediaProviderProfileSecrets(profiles = []) {
  const allowed = new Set(normalizeMediaProviderProfiles(profiles).map((profile) => `${profile.providerId}:${profile.id}`));
  const store = readStore();
  let changed = false;
  for (const name of Object.keys(store.values || {})) {
    const match = MEDIA_PROFILE_SECRET_RE.exec(name);
    if (match && !allowed.has(`${match[1]}:${match[2]}`)) {
      delete store.values[name];
      changed = true;
    }
  }
  if (changed) writeStore(store);
  return changed;
}

function apiProviderStatusMap() {
  const store = readStore();
  const map = {};
  for (const name of Object.keys(store.values || {})) {
    const match = API_PROVIDER_SECRET_RE.exec(name);
    if (!match) continue;
    const [, id, field] = match;
    if (!map[id]) map[id] = {};
    map[id][field] = true;
  }
  return map;
}

function mediaProviderProfileStatuses(profiles = []) {
  const store = readStore();
  const values = store.values || {};
  return normalizeMediaProviderProfiles(profiles).map((profile) => {
    const fields = {};
    for (const name of Object.keys(values)) {
      const match = MEDIA_PROFILE_SECRET_RE.exec(name);
      if (!match || match[1] !== profile.providerId || match[2] !== profile.id) continue;
      fields[match[3]] = true;
    }
    return {
      id: profile.id,
      providerId: profile.providerId,
      mode: profile.mode,
      fields,
      mcpAuthorized: !!fields.oauthTokens,
    };
  });
}

function ensureLocalRouterToken() {
  const current = getSecret(LOCAL_ROUTER_TOKEN);
  if (current) return current;
  if (!encryptionAvailable()) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없어 로컬 라우터 인증 토큰을 만들 수 없습니다.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  saveSecrets({ [LOCAL_ROUTER_TOKEN]: token });
  return token;
}

function openRouterProfileStatuses(profiles = []) {
  return normalizeOpenRouterProfiles(profiles).map((profile) => {
    const secrets = loadOpenRouterProfileSecrets(profile.id);
    return {
      id: profile.id,
      apiKeyConfigured: !!secrets.apiKey,
      managementKeyConfigured: !!secrets.managementKey,
    };
  });
}

function secretStatus(profiles = [], mediaProfiles = []) {
  const defaultSecrets = loadOpenRouterProfileSecrets("default");
  return {
    encryptionAvailable: encryptionAvailable(),
    openrouterApiKeyConfigured: !!defaultSecrets.apiKey,
    openrouterManagementKeyConfigured: !!defaultSecrets.managementKey,
    openRouterProfileStatuses: openRouterProfileStatuses(profiles),
    openRouterLocalRouterTokenConfigured: !!getSecret(LOCAL_ROUTER_TOKEN),
    apiProviders: apiProviderStatusMap(),
    mediaProviderProfileStatuses: mediaProviderProfileStatuses(mediaProfiles),
  };
}

function loadProviderSecrets() {
  const defaultSecrets = loadOpenRouterProfileSecrets("default");
  return {
    openrouter: {
      apiKey: defaultSecrets.apiKey,
      managementKey: defaultSecrets.managementKey,
    },
  };
}

module.exports = {
  STORE_VERSION,
  ALLOWED_SECRETS,
  PROFILE_SECRET_RE,
  API_PROVIDER_SECRET_RE,
  MEDIA_PROFILE_SECRET_RE,
  MCP_SECRET_FIELDS,
  LOCAL_ROUTER_TOKEN,
  secretsPath,
  encryptionAvailable,
  profileSecretName,
  cleanApiProviderId,
  apiProviderSecretName,
  mediaProfileSecretName,
  loadApiProviderSecrets,
  saveApiProviderSecrets,
  clearApiProviderSecrets,
  loadMediaProviderProfileSecrets,
  saveMediaProviderProfileSecrets,
  clearMediaProviderProfileSecrets,
  pruneMediaProviderProfileSecrets,
  apiProviderStatusMap,
  mediaProviderProfileStatuses,
  assertAllowed,
  getSecret,
  saveSecrets,
  clearSecrets,
  loadOpenRouterProfileSecrets,
  saveOpenRouterProfileSecrets,
  clearOpenRouterProfileSecrets,
  clearAllOpenRouterProfileSecrets,
  pruneOpenRouterProfileSecrets,
  migrateLegacyOpenRouterSecrets,
  ensureLocalRouterToken,
  openRouterProfileStatuses,
  secretStatus,
  loadProviderSecrets,
};
