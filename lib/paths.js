const fs = require("fs");
const os = require("os");
const path = require("path");

function home() {
  return os.homedir();
}

function appData() {
  return process.env.APPDATA || path.join(home(), "AppData", "Roaming");
}

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local");
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function firstExisting(paths) {
  return paths.find((p) => p && exists(p)) || null;
}

function cursorStateDb() {
  return firstExisting([
    path.join(appData(), "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(home(), ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(home(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
  ]);
}

function cursorAuthFiles() {
  return [
    path.join(home(), ".cursor", "auth.json"),
    path.join(home(), ".config", "cursor", "auth.json"),
    path.join(appData(), "cursor", "auth.json"),
  ].filter(exists);
}

function copilotAuthFiles() {
  return [
    path.join(home(), ".config", "github-copilot", "apps.json"),
    path.join(home(), ".config", "github-copilot", "hosts.json"),
    path.join(appData(), "GitHub Copilot", "apps.json"),
    path.join(localAppData(), "github-copilot", "apps.json"),
    path.join(localAppData(), "github-copilot", "hosts.json"),
  ].filter(exists);
}

function ghHostsFile() {
  return firstExisting([
    path.join(home(), ".config", "gh", "hosts.yml"),
    path.join(appData(), "GitHub CLI", "hosts.yml"),
  ]);
}

module.exports = {
  home,
  appData,
  localAppData,
  exists,
  readJson,
  writeJson,
  firstExisting,
  cursorStateDb,
  cursorAuthFiles,
  copilotAuthFiles,
  ghHostsFile,
};
