const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULTS,
  RESET_PRESERVED_FIELDS,
  resetSettingsValues,
} = require("../lib/settings");

assert.deepStrictEqual(RESET_PRESERVED_FIELDS, ["githubToken", "cursorCookie"]);

const current = {
  alwaysOnTop: false,
  opacity: 0.61,
  refreshSeconds: 300,
  openAtLogin: true,
  compact: true,
  hideMissing: false,
  visualization: "number",
  denseLayout: true,
  edgeDockEnabled: true,
  edgeDockSide: "bottom",
  tokenAreaMaxHeight: 480,
  position: { x: 9000, y: -4000 },
  githubToken: "github-secret",
  cursorCookie: "cursor-secret",
};

const safeReset = resetSettingsValues(current, { preserveCredentials: true });
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (RESET_PRESERVED_FIELDS.includes(key)) continue;
  assert.deepStrictEqual(safeReset[key], value, `expected ${key} to reset to default`);
}
assert.strictEqual(safeReset.githubToken, "github-secret");
assert.strictEqual(safeReset.cursorCookie, "cursor-secret");

const fullReset = resetSettingsValues(current, { preserveCredentials: false });
assert.deepStrictEqual(fullReset, DEFAULTS);

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
assert.ok(main.includes("function safeInitialBounds"), "startup must clamp persisted positions");
assert.ok(main.includes("startupVisible: true"), "persisted edge mode must start visibly");
assert.ok(main.includes("EDGE_STARTUP_GRACE_MS"), "edge startup recovery needs a visible grace period");
assert.ok(main.includes('label: "설정값 초기화"'), "tray reset menu must exist");
assert.ok(main.includes("resetSettings({ preserveCredentials: true })"), "tray reset must preserve account credentials");
assert.ok(main.includes("reloadIgnoringCache"), "renderer settings should refresh after reset");

console.log("settings reset and startup recovery tests passed");
