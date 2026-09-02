const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { readJson, writeJson } = require("./paths");

const VISUALIZATION_MODES = ["ring", "bar", "number"];
const EDGE_DOCK_SIDES = ["top", "right", "bottom", "left"];

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
  position: null,
  githubToken: "",
  cursorCookie: "",
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  if (!VISUALIZATION_MODES.includes(next.visualization)) next.visualization = DEFAULTS.visualization;
  if (!EDGE_DOCK_SIDES.includes(next.edgeDockSide)) next.edgeDockSide = DEFAULTS.edgeDockSide;
  next.denseLayout = next.denseLayout === true;
  next.edgeDockEnabled = next.edgeDockEnabled === true;
  return next;
}

function loadSettings() {
  return normalizeSettings(readJson(settingsPath()) || {});
}

function saveSettings(next) {
  const merged = normalizeSettings({ ...loadSettings(), ...(next || {}) });
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeJson(settingsPath(), merged);
  return merged;
}

module.exports = {
  DEFAULTS,
  VISUALIZATION_MODES,
  EDGE_DOCK_SIDES,
  normalizeSettings,
  loadSettings,
  saveSettings,
};
