const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  DEFAULTS,
  RESET_DISPLAY_MODES,
  RESET_PRESERVED_FIELDS,
  normalizeSettings,
  resetSettingsValues,
} = require("../lib/settings");

assert.deepStrictEqual(RESET_PRESERVED_FIELDS, ["githubToken", "cursorCookie", "accountProfiles", "openRouterProfiles"]);
assert.deepStrictEqual(RESET_DISPLAY_MODES, ["auto", "relative", "absolute"]);
assert.strictEqual(DEFAULTS.resetDisplayMode, "auto", "reset display should preserve the existing five-second automatic rotation by default");
assert.strictEqual(normalizeSettings({ resetDisplayMode: "relative" }).resetDisplayMode, "relative");
assert.strictEqual(normalizeSettings({ resetDisplayMode: "absolute" }).resetDisplayMode, "absolute");
assert.strictEqual(normalizeSettings({ resetDisplayMode: "invalid" }).resetDisplayMode, "auto", "invalid reset display values must fall back safely");
assert.strictEqual(DEFAULTS.codexAutoUseReset, false, "automatic reset-ticket consumption must be opt-in");
assert.deepStrictEqual(DEFAULTS.accountProfiles, [], "multi-account profiles must be opt-in");
assert.deepStrictEqual(DEFAULTS.openRouterProfiles, [], "OpenRouter key profiles must be opt-in");
assert.strictEqual(DEFAULTS.openRouterRouter.enabled, false, "localhost API router must be opt-in");
assert.strictEqual(DEFAULTS.smartRouting.codex.enabled, false, "smart routing must be opt-in");
assert.strictEqual(DEFAULTS.smartRouting.claude.enabled, false, "smart routing must be opt-in");
assert.strictEqual(DEFAULTS.smartRouting.grok.enabled, false, "smart routing must be opt-in");

const current = {
  alwaysOnTop: false,
  opacity: 0.61,
  refreshSeconds: 300,
  openAtLogin: true,
  compact: true,
  hideMissing: false,
  visualization: "number",
  resetDisplayMode: "absolute",
  denseLayout: true,
  edgeDockEnabled: true,
  edgeDockSide: "bottom",
  tokenAreaMaxHeight: 480,
  codexAutoUseReset: true,
  smartRouting: {
    codex: { enabled: true, policy: "max-remaining", thresholdPct: 5 },
    claude: { enabled: true, policy: "priority-fallback", thresholdPct: 1 },
  },
  openRouterEnabled: true,
  openRouterProfiles: [
    { id: "primary", label: "주 키", priority: 10, enabled: true },
    { id: "backup", label: "백업 키", priority: 20, enabled: true },
  ],
  openRouterRouter: { enabled: true, port: 45555, policy: "max-remaining" },
  position: { x: 9000, y: -4000 },
  githubToken: "github-secret",
  cursorCookie: "cursor-secret",
  accountProfiles: [
    { providerId: "codex", label: "GPT 2번", configDir: path.join(os.tmpdir(), "codex-2") },
  ],
};

const safeReset = resetSettingsValues(current, { preserveCredentials: true });
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (RESET_PRESERVED_FIELDS.includes(key)) continue;
  assert.deepStrictEqual(safeReset[key], value, `expected ${key} to reset to default`);
}
assert.strictEqual(safeReset.resetDisplayMode, "auto", "settings reset must restore automatic reset-time display");
assert.strictEqual(safeReset.codexAutoUseReset, false, "settings reset must turn destructive automation back off");
assert.strictEqual(safeReset.smartRouting.codex.enabled, false, "settings reset must disable automatic account routing");
assert.strictEqual(safeReset.openRouterRouter.enabled, false, "settings reset must stop localhost API routing");
assert.strictEqual(safeReset.githubToken, "github-secret");
assert.strictEqual(safeReset.cursorCookie, "cursor-secret");
assert.strictEqual(safeReset.accountProfiles.length, 1, "isolated login profile paths should survive a safe settings reset");
assert.strictEqual(safeReset.accountProfiles[0].label, "GPT 2번");
assert.deepStrictEqual(safeReset.openRouterProfiles.map((profile) => profile.id), ["primary", "backup"]);
assert.strictEqual(safeReset.openRouterProfiles[0].label, "주 키");

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
const providerSettings = fs.readFileSync(path.join(__dirname, "..", "renderer", "openrouter-settings.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
assert.ok(html.includes('id="codexAutoUseReset"'), "Codex auto reset toggle must exist");
assert.ok(html.includes("기본값은 꺼짐"));
assert.ok(html.includes('id="accountProfiles"'), "multi-account profile editor must exist");
assert.ok(html.includes('id="openRouterProfiles"'), "OpenRouter key-profile editor must exist");
assert.ok(html.includes('id="openRouterRouterEnabled"'), "localhost OpenRouter router toggle must exist");
assert.ok(renderer.includes("parseAccountProfiles"), "multi-account profile editor must be wired to settings");
assert.ok(renderer.includes("codexAutoUseReset"));
assert.ok(renderer.includes("creditBalances"), "shared credit balance rendering must be wired");
assert.ok(providerSettings.includes("parseOpenRouterProfiles"), "OpenRouter profile editor must be wired");
assert.ok(providerSettings.includes("openRouterRouterPolicy"), "OpenRouter router policy controls must be wired");
assert.ok(providerSettings.includes("Smart Routing"), "Smart Routing settings UI must be installed");
assert.ok(providerSettings.includes("data-route-launch"), "Smart Routing launch buttons must exist");
assert.ok(preload.includes("routeLaunch"), "preload must expose constrained routed launches");
assert.ok(preload.includes("installSmartRoutingLaunchers"), "preload must expose launcher installation");

console.log("settings reset / startup recovery / safe automation defaults tests passed");
