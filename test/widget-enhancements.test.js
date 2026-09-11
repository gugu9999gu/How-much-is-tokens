const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const enhancement = fs.readFileSync(path.join(root, "renderer", "widget-enhancements.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "widget-enhancements.css"), "utf8");
const identityUi = fs.readFileSync(path.join(root, "renderer", "account-identity-ui.js"), "utf8");
const identityCss = fs.readFileSync(path.join(root, "renderer", "account-identity-ui.css"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const integration = fs.readFileSync(path.join(root, "lib", "api-providers-main-integration.js"), "utf8");
const rendererApp = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
const rendererCss = fs.readFileSync(path.join(root, "renderer", "styles.css"), "utf8");
const logoDir = path.join(root, "renderer", "assets", "platform-logos");

assert.ok(enhancement.includes("RESET_MODE_INTERVAL_MS = 5_000"), "reset countdown/date mode must rotate every five seconds in automatic mode");
assert.ok(enhancement.includes('new Set(["auto", "relative", "absolute"])'), "reset display mode must support auto, remaining-time and scheduled-date choices");
assert.ok(enhancement.includes('field.id = "resetDisplayModeField"'), "settings must install a reset display preference field");
assert.ok(enhancement.includes('input.name = "resetDisplayMode"'), "reset display options must be one radio group");
assert.ok(enhancement.includes('api.saveSettings({ resetDisplayMode: requested })'), "reset display selection must persist immediately");
assert.ok(enhancement.includes('if (resetDisplayPreference !== "auto") return;'), "forced reset display modes must not alternate every five seconds");
assert.ok(enhancement.includes("effectiveResetDisplayMode"), "rendered reset text must respect the configured display mode");
assert.ok(enhancement.includes("resetDateTimeText"), "scheduled reset date/time formatter must exist");
assert.ok(enhancement.includes('id = "headerEdgeDockToggle"'), "header edge-dock toggle must be installed outside settings");
assert.ok(enhancement.includes("manualWindowResize"), "renderer border handles must drive native window bounds");
assert.ok(enhancement.includes("disconnectCredential"), "connection cards must expose disconnect controls");
assert.ok(enhancement.includes("getCliVersions"), "connection cards must display detected CLI versions");
assert.ok(enhancement.includes("updateAvailable && status.updateSupported"), "CLI update button must appear only when a newer version is detected and updating is supported");
assert.ok(css.includes(".widget-resize-handle"), "window edge/corner resize hit targets must be styled");
assert.ok(css.includes(".header-edge-toggle"), "minimal header edge toggle must be styled");
assert.ok(css.includes("repeat(auto-fit, minmax(min(100%, 280px), 1fr))"), "provider token cards must add/remove columns with widget width");
assert.ok(css.includes("repeat(auto-fit, minmax(min(100%, 120px), 1fr))"), "multi-quota cells must also use available card width responsively");
assert.ok(css.includes(".shell.settings-open .settings"), "settings viewport override must be scoped to the open settings page");
assert.ok(css.includes("flex: 1 1 auto"), "settings must keep intrinsic sizing while growing into manually available height");
assert.ok(css.includes("max-height: none"), "settings must remove the legacy fixed-height cap");

assert.ok(identityUi.includes("accountEmail"), "quota cards must consume authenticated account email metadata");
assert.ok(identityUi.includes("accountId"), "quota cards must consume authenticated account ID metadata");
assert.ok(identityUi.includes("account-identity-line"), "quota cards must render a minimal identity line");
assert.ok(identityUi.includes(":scope > .provider-title, :scope > b"), "account identity insertion must remain compatible with logo-wrapped provider titles");
assert.ok(identityUi.includes("deduplicatedAccounts"), "duplicate-account suppression should provide a user-facing explanation");
assert.ok(identityCss.includes(".account-identity-line"));

assert.ok(preload.includes('settings = await ipcRenderer.invoke("get-settings")'), "usage delivery must refresh settings after long provider fetches so compact mode cannot revert from stale settings");
assert.ok(preload.includes("widget-enhancements.js"), "preload must inject the enhancement script after the existing renderer scripts");
assert.ok(preload.includes("account-identity-ui.js"), "preload must inject authenticated-account identity UI");
assert.ok(preload.includes("account-identity-ui.css"), "preload must inject minimal authenticated-account identity styling");
assert.ok(preload.includes("manualHeightLocked"), "content auto-height must stop overriding a manually selected height");
assert.ok(integration.includes('require("./window-resize-main-integration")'));
assert.ok(integration.includes('require("./cli-maintenance-main-integration")'));

const expectedPlatformLogos = [
  "openai",
  "anthropic",
  "antigravity",
  "grok",
  "cursor",
  "github",
  "openrouter",
  "falai",
  "higgsfield",
  "magnific",
  "elevenlabs",
];
for (const name of expectedPlatformLogos) {
  const svg = fs.readFileSync(path.join(logoDir, `${name}.svg`), "utf8");
  assert.ok(/<svg\b/i.test(svg), `${name} platform logo must be a real SVG asset`);
}
assert.ok(fs.readFileSync(path.join(logoDir, "anthropic.svg"), "utf8").includes('viewBox="0 0 35 24"'), "Anthropic asset must be the official A-mark, not a nearby navigation chevron");
assert.ok(fs.readFileSync(path.join(logoDir, "antigravity.svg"), "utf8").includes('viewBox="0 0 869 113"'), "Antigravity asset must be the official wordmark SVG");
assert.ok(fs.readFileSync(path.join(logoDir, "falai.svg"), "utf8").includes('viewBox="0 0 120 48"'), "fal.ai asset must be the official homepage logo SVG");
assert.ok(rendererApp.includes("const PROVIDER_LOGOS = {"), "renderer must map provider IDs to local SVG assets");
assert.ok(rendererApp.includes('.split(":")[0]'), "multi-account provider IDs must resolve to their base provider logo");
assert.ok(rendererApp.includes("renderProviderTitle(provider, account, plan)"), "provider cards must render the logo next to the provider title");
assert.ok(rendererApp.includes('stability: { fallback: "S", label: "Stability AI" }'), "Stability must use the non-logo fallback tile");
assert.ok(!fs.existsSync(path.join(logoDir, "stability.svg")), "Stability logo must not be bundled without written permission");
assert.ok(rendererCss.includes(".provider-logo"), "provider SVG tile must be styled");
assert.ok(rendererCss.includes(".provider-logo--wide"), "wide official wordmarks must have a dedicated layout");
assert.ok(rendererCss.includes(".row.compact .provider-logo"), "platform logos must resize with compact cards");

console.log("minimal widget enhancement wiring tests passed");
