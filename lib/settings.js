const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { readJson, writeJson } = require("./paths");

const VISUALIZATION_MODES = ["ring", "bar", "number"];
const EDGE_DOCK_SIDES = ["top", "right", "bottom", "left"];
const TOKEN_AREA_MIN_HEIGHT = 120;
const TOKEN_AREA_MAX_HEIGHT = 2000;
const RESET_PRESERVED_FIELDS = ["githubToken", "cursorCookie"];
const SECURE_INPUT_FIELDS = ["openRouterApiKey", "openRouterManagementKey"];

const DEFAULTS = {
  alwaysOnTop: true,
  opacity: 0.94,
  refreshSeconds: 60,
  openAtLogin: false,
  compact: false,
  hideMissing: true,
  visualization: "ring",
  denseLayout: false,
  edgeDockEnabled: false,
  edgeDockSide: "right",
  tokenAreaMaxHeight: 0,
  position: null,
  githubToken: "",
  cursorCookie: "",
  openRouterEnabled: false,
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeTokenAreaMaxHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.max(TOKEN_AREA_MIN_HEIGHT, Math.min(TOKEN_AREA_MAX_HEIGHT, Math.round(height)));
}

function normalizeSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  for (const field of SECURE_INPUT_FIELDS) delete next[field];
  delete next.clearOpenRouterSecrets;
  delete next.openrouterApiKeyConfigured;
  delete next.openrouterManagementKeyConfigured;
  delete next.secureStorageAvailable;
  if (!VISUALIZATION_MODES.includes(next.visualization)) next.visualization = DEFAULTS.visualization;
  if (!EDGE_DOCK_SIDES.includes(next.edgeDockSide)) next.edgeDockSide = DEFAULTS.edgeDockSide;
  next.denseLayout = next.denseLayout === true;
  next.edgeDockEnabled = next.edgeDockEnabled === true;
  next.openRouterEnabled = next.openRouterEnabled === true;
  next.tokenAreaMaxHeight = normalizeTokenAreaMaxHeight(next.tokenAreaMaxHeight);
  return next;
}

function resetSettingsValues(current = {}, options = {}) {
  const preserveCredentials = options.preserveCredentials !== false;
  const next = { ...DEFAULTS };

  if (preserveCredentials) {
    for (const field of RESET_PRESERVED_FIELDS) {
      if (typeof current[field] === "string") next[field] = current[field];
    }
  }

  return normalizeSettings(next);
}

function rawSettings() {
  return normalizeSettings(readJson(settingsPath()) || {});
}

function secretStatusSafe() {
  try {
    const status = require("./secure-secrets").secretStatus();
    return {
      secureStorageAvailable: status.encryptionAvailable === true,
      openrouterApiKeyConfigured: status.openrouterApiKeyConfigured === true,
      openrouterManagementKeyConfigured: status.openrouterManagementKeyConfigured === true,
    };
  } catch {
    return {
      secureStorageAvailable: false,
      openrouterApiKeyConfigured: false,
      openrouterManagementKeyConfigured: false,
    };
  }
}

function withSecretStatus(settings) {
  return { ...settings, ...secretStatusSafe() };
}

function applySecretPatch(next = {}) {
  const securePatch = {};
  for (const field of SECURE_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(next, field) && typeof next[field] === "string" && next[field].trim()) {
      securePatch[field === "openRouterApiKey" ? "openrouterApiKey" : "openrouterManagementKey"] = next[field].trim();
    }
  }

  const secretStore = require("./secure-secrets");
  if (Object.keys(securePatch).length > 0) secretStore.saveSecrets(securePatch);
  if (next.clearOpenRouterSecrets === true) {
    secretStore.clearSecrets(["openrouterApiKey", "openrouterManagementKey"]);
  }
}

function loadSettings() {
  return withSecretStatus(rawSettings());
}

function saveSettings(next) {
  const patch = { ...(next || {}) };
  const hasSecretOperation = SECURE_INPUT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field)) || patch.clearOpenRouterSecrets === true;
  if (hasSecretOperation) applySecretPatch(patch);
  for (const field of SECURE_INPUT_FIELDS) delete patch[field];
  delete patch.clearOpenRouterSecrets;

  const merged = normalizeSettings({ ...rawSettings(), ...patch });
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeJson(settingsPath(), merged);
  return withSecretStatus(merged);
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
  EDGE_DOCK_SIDES,
  TOKEN_AREA_MIN_HEIGHT,
  TOKEN_AREA_MAX_HEIGHT,
  RESET_PRESERVED_FIELDS,
  SECURE_INPUT_FIELDS,
  normalizeTokenAreaMaxHeight,
  normalizeSettings,
  resetSettingsValues,
  loadSettings,
  saveSettings,
  resetSettings,
  secretStatusSafe,
};
