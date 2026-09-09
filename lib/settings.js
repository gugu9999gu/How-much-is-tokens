const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { readJson, writeJson } = require("./paths");
const { normalizeAccountProfiles } = require("./account-profiles");
const { normalizeSmartRouting } = require("./account-router");
const { normalizeManualWindowSize } = require("./window-resize");
const {
  normalizeOpenRouterProfiles,
  normalizeOpenRouterRouter,
  defaultOpenRouterProfile,
} = require("./openrouter-profiles");

const VISUALIZATION_MODES = ["ring", "bar", "number"];
const RESET_DISPLAY_MODES = ["auto", "relative", "absolute"];
const EDGE_DOCK_SIDES = ["top", "right", "bottom", "left"];
const TOKEN_AREA_MIN_HEIGHT = 120;
const TOKEN_AREA_MAX_HEIGHT = 2000;
const DISCONNECTABLE_CREDENTIAL_PROVIDERS = ["codex", "claude", "grok", "cursor", "grokbot", "copilot", "antigravity"];
const RESET_PRESERVED_FIELDS = ["githubToken", "cursorCookie", "accountProfiles", "openRouterProfiles"];
const SECURE_INPUT_FIELDS = ["openRouterApiKey", "openRouterManagementKey"];
let secretStatusCache = null;
let secretStatusCacheKey = "";
let legacyMigrationChecked = false;

const DEFAULTS = {
  alwaysOnTop: true,
  opacity: 0.94,
  refreshSeconds: 60,
  openAtLogin: false,
  compact: false,
  hideMissing: true,
  visualization: "ring",
  resetDisplayMode: "auto",
  denseLayout: false,
  edgeDockEnabled: false,
  edgeDockSide: "right",
  tokenAreaMaxHeight: 0,
  position: null,
  manualWindowSize: null,
  disabledCredentialProviders: [],
  githubToken: "",
  cursorCookie: "",
  accountProfiles: [],
  smartRouting: normalizeSmartRouting(),
  openRouterEnabled: false,
  openRouterProfiles: [],
  openRouterRouter: normalizeOpenRouterRouter(),
  codexAutoUseReset: false,
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeTokenAreaMaxHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.max(TOKEN_AREA_MIN_HEIGHT, Math.min(TOKEN_AREA_MAX_HEIGHT, Math.round(height)));
}

function normalizeDisabledCredentialProviders(value) {
  const allowed = new Set(DISCONNECTABLE_CREDENTIAL_PROVIDERS);
  const requested = new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => allowed.has(item)));
  return DISCONNECTABLE_CREDENTIAL_PROVIDERS.filter((id) => requested.has(id));
}

function normalizeSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  for (const field of SECURE_INPUT_FIELDS) delete next[field];
  delete next.clearOpenRouterSecrets;
  delete next.openrouterApiKeyConfigured;
  delete next.openrouterManagementKeyConfigured;
  delete next.openRouterProfileStatuses;
  delete next.openRouterLocalRouterTokenConfigured;
  delete next.openRouterRouterStatus;
  delete next.apiProviderStatuses;
  delete next.secureStorageAvailable;
  if (!VISUALIZATION_MODES.includes(next.visualization)) next.visualization = DEFAULTS.visualization;
  if (!RESET_DISPLAY_MODES.includes(next.resetDisplayMode)) next.resetDisplayMode = DEFAULTS.resetDisplayMode;
  if (!EDGE_DOCK_SIDES.includes(next.edgeDockSide)) next.edgeDockSide = DEFAULTS.edgeDockSide;
  next.denseLayout = next.denseLayout === true;
  next.edgeDockEnabled = next.edgeDockEnabled === true;
  next.openRouterEnabled = next.openRouterEnabled === true;
  next.codexAutoUseReset = next.codexAutoUseReset === true;
  next.accountProfiles = normalizeAccountProfiles(next.accountProfiles);
  next.smartRouting = normalizeSmartRouting(next.smartRouting);
  next.openRouterProfiles = normalizeOpenRouterProfiles(next.openRouterProfiles);
  next.openRouterRouter = normalizeOpenRouterRouter(next.openRouterRouter);
  next.tokenAreaMaxHeight = normalizeTokenAreaMaxHeight(next.tokenAreaMaxHeight);
  next.manualWindowSize = normalizeManualWindowSize(next.manualWindowSize);
  next.disabledCredentialProviders = normalizeDisabledCredentialProviders(next.disabledCredentialProviders);
  return next;
}

function resetSettingsValues(current = {}, options = {}) {
  const preserveCredentials = options.preserveCredentials !== false;
  const next = {
    ...DEFAULTS,
    smartRouting: normalizeSmartRouting(),
    openRouterRouter: normalizeOpenRouterRouter(),
  };

  if (preserveCredentials) {
    for (const field of RESET_PRESERVED_FIELDS) {
      if (field === "accountProfiles") {
        next.accountProfiles = normalizeAccountProfiles(current.accountProfiles);
      } else if (field === "openRouterProfiles") {
        next.openRouterProfiles = normalizeOpenRouterProfiles(current.openRouterProfiles);
      } else if (typeof current[field] === "string") {
        next[field] = current[field];
      }
    }
  }

  return normalizeSettings(next);
}

function invalidateSecretStatusCache() {
  secretStatusCache = null;
  secretStatusCacheKey = "";
}

function maybeMigrateLegacyOpenRouter(settings) {
  if (legacyMigrationChecked) return settings;
  legacyMigrationChecked = true;
  try {
    const secretStore = require("./secure-secrets");
    const migration = secretStore.migrateLegacyOpenRouterSecrets("default");
    if (!migration.hadLegacy) return settings;
    const profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
    if (profiles.some((profile) => profile.id === "default")) return settings;
    const migrated = normalizeSettings({
      ...settings,
      openRouterProfiles: [defaultOpenRouterProfile(), ...profiles],
    });
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    writeJson(settingsPath(), migrated);
    invalidateSecretStatusCache();
    return migrated;
  } catch {
    return settings;
  }
}

function rawSettings() {
  const normalized = normalizeSettings(readJson(settingsPath()) || {});
  return maybeMigrateLegacyOpenRouter(normalized);
}

function statusCacheKey(settings = {}) {
  return normalizeOpenRouterProfiles(settings.openRouterProfiles)
    .map((profile) => profile.id)
    .join("|");
}

function cloneApiProviderStatuses(statuses) {
  const out = {};
  if (statuses && typeof statuses === "object") {
    for (const [id, fields] of Object.entries(statuses)) {
      out[id] = fields && typeof fields === "object" ? { ...fields } : {};
    }
  }
  return out;
}

function cloneSecretStatus(status) {
  return {
    ...(status || {}),
    openRouterProfileStatuses: Array.isArray(status && status.openRouterProfileStatuses)
      ? status.openRouterProfileStatuses.map((item) => ({ ...item }))
      : [],
    apiProviderStatuses: cloneApiProviderStatuses(status && status.apiProviderStatuses),
  };
}

function secretStatusSafe(settings = {}, force = false) {
  const key = statusCacheKey(settings);
  if (!force && secretStatusCache && secretStatusCacheKey === key) {
    return cloneSecretStatus(secretStatusCache);
  }
  try {
    const status = require("./secure-secrets").secretStatus(settings.openRouterProfiles);
    secretStatusCache = {
      secureStorageAvailable: status.encryptionAvailable === true,
      openrouterApiKeyConfigured: status.openrouterApiKeyConfigured === true,
      openrouterManagementKeyConfigured: status.openrouterManagementKeyConfigured === true,
      openRouterProfileStatuses: Array.isArray(status.openRouterProfileStatuses)
        ? status.openRouterProfileStatuses.map((item) => ({ ...item }))
        : [],
      openRouterLocalRouterTokenConfigured: status.openRouterLocalRouterTokenConfigured === true,
      apiProviderStatuses: cloneApiProviderStatuses(status.apiProviders),
    };
    secretStatusCacheKey = key;
  } catch {
    secretStatusCache = {
      secureStorageAvailable: false,
      openrouterApiKeyConfigured: false,
      openrouterManagementKeyConfigured: false,
      openRouterProfileStatuses: [],
      openRouterLocalRouterTokenConfigured: false,
      apiProviderStatuses: {},
    };
    secretStatusCacheKey = key;
  }
  return cloneSecretStatus(secretStatusCache);
}

function withSecretStatus(settings, force = false) {
  return { ...settings, ...secretStatusSafe(settings, force) };
}

function hasNewLegacySecretInput(next = {}) {
  return SECURE_INPUT_FIELDS.some((field) =>
    typeof next[field] === "string" && next[field].trim(),
  );
}

function ensureDefaultProfileForLegacyInput(settings) {
  const profiles = normalizeOpenRouterProfiles(settings.openRouterProfiles);
  if (profiles.some((profile) => profile.id === "default")) return settings;
  return {
    ...settings,
    openRouterProfiles: normalizeOpenRouterProfiles([defaultOpenRouterProfile(), ...profiles]),
  };
}

function applySecretPatch(next = {}) {
  const securePatch = {};
  if (typeof next.openRouterApiKey === "string" && next.openRouterApiKey.trim()) {
    securePatch.apiKey = next.openRouterApiKey.trim();
  }
  if (typeof next.openRouterManagementKey === "string" && next.openRouterManagementKey.trim()) {
    securePatch.managementKey = next.openRouterManagementKey.trim();
  }

  const secretStore = require("./secure-secrets");
  if (Object.keys(securePatch).length > 0) secretStore.saveOpenRouterProfileSecrets("default", securePatch);
  if (next.clearOpenRouterSecrets === true) secretStore.clearAllOpenRouterProfileSecrets();
  invalidateSecretStatusCache();
}

function loadSettings() {
  return withSecretStatus(rawSettings());
}

function saveSettings(next) {
  const patch = { ...(next || {}) };
  const hasSecretOperation = SECURE_INPUT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field)) || patch.clearOpenRouterSecrets === true;
  const addDefaultProfile = hasNewLegacySecretInput(patch);
  if (hasSecretOperation) applySecretPatch(patch);
  for (const field of SECURE_INPUT_FIELDS) delete patch[field];
  delete patch.clearOpenRouterSecrets;

  let merged = normalizeSettings({ ...rawSettings(), ...patch });
  if (addDefaultProfile) merged = normalizeSettings(ensureDefaultProfileForLegacyInput(merged));

  if (Object.prototype.hasOwnProperty.call(patch, "openRouterProfiles")) {
    try {
      require("./secure-secrets").pruneOpenRouterProfileSecrets(merged.openRouterProfiles.map((profile) => profile.id));
    } catch {}
    invalidateSecretStatusCache();
  }

  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeJson(settingsPath(), merged);
  return withSecretStatus(merged, hasSecretOperation || Object.prototype.hasOwnProperty.call(patch, "openRouterProfiles"));
}

function resetSettings(options = {}) {
  const next = resetSettingsValues(rawSettings(), options);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeJson(settingsPath(), next);
  // Secure API-provider credentials are intentionally stored separately and
  // survive a UI settings reset, just like the existing account credentials.
  return withSecretStatus(next);
}

module.exports = {
  DEFAULTS,
  VISUALIZATION_MODES,
  RESET_DISPLAY_MODES,
  EDGE_DOCK_SIDES,
  TOKEN_AREA_MIN_HEIGHT,
  TOKEN_AREA_MAX_HEIGHT,
  DISCONNECTABLE_CREDENTIAL_PROVIDERS,
  RESET_PRESERVED_FIELDS,
  SECURE_INPUT_FIELDS,
  normalizeTokenAreaMaxHeight,
  normalizeDisabledCredentialProviders,
  normalizeSettings,
  resetSettingsValues,
  loadSettings,
  saveSettings,
  resetSettings,
  secretStatusSafe,
  invalidateSecretStatusCache,
};
