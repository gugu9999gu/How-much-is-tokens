const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULTS,
  RESET_PRESERVED_FIELDS,
  resetSettingsValues,
} = require("../lib/settings");

assert.deepStrictEqual(RESET_PRESERVED_FIELDS, ["githubToken", "cursorCookie"]);
assert.strictEqual(DEFAULTS.codexAutoUseReset, false, "automatic reset-ticket consumption must be opt-in");

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
  codexAutoUseReset: true,
  openRouterEnabled: true,
  position: { x: 9000, y: -4000 },
  githubToken: "github-secret",
  cursorCookie: "cursor-secret",
};

const safeReset = resetSettingsValues(current, { preserveCredentials: true });
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (RESET_PRESERVED_FIELDS.includes(key)) continue;
  assert.deepStrictEqual(safeReset[key], value, `expected ${key} to reset to default`);
}
assert.strictEqual(safeReset.codexAutoUseReset, false, "settings reset must turn destructive automation back off");
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

const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
assert.ok(html.includes('id="codexAutoUseReset"'), "Codex auto reset toggle must exist");
assert.ok(html.includes("기본값은 꺼짐"));
assert.ok(renderer.includes("codexAutoUseReset"));
assert.ok(renderer.includes("creditBalances"), "shared credit balance rendering must be wired");

console.log("settings reset / startup recovery / safe automation defaults tests passed");
