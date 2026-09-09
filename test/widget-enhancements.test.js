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

assert.ok(enhancement.includes("RESET_MODE_INTERVAL_MS = 5_000"), "reset countdown/date mode must rotate every five seconds");
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
assert.ok(identityUi.includes("deduplicatedAccounts"), "duplicate-account suppression should provide a user-facing explanation");
assert.ok(identityCss.includes(".account-identity-line"));

assert.ok(preload.includes('settings = await ipcRenderer.invoke("get-settings")'), "usage delivery must refresh settings after long provider fetches so compact mode cannot revert from stale settings");
assert.ok(preload.includes("widget-enhancements.js"), "preload must inject the enhancement script after the existing renderer scripts");
assert.ok(preload.includes("account-identity-ui.js"), "preload must inject authenticated-account identity UI");
assert.ok(preload.includes("account-identity-ui.css"), "preload must inject minimal authenticated-account identity styling");
assert.ok(preload.includes("manualHeightLocked"), "content auto-height must stop overriding a manually selected height");
assert.ok(integration.includes('require("./window-resize-main-integration")'));
assert.ok(integration.includes('require("./cli-maintenance-main-integration")'));

console.log("minimal widget enhancement wiring tests passed");
