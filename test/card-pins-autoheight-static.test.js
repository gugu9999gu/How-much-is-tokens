const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const enhancement = fs.readFileSync(path.join(root, "renderer", "card-pins-autoheight.js"), "utf8");
const style = fs.readFileSync(path.join(root, "renderer", "card-pins-autoheight.css"), "utf8");
const identity = fs.readFileSync(path.join(root, "renderer", "account-identity-ui.js"), "utf8");
const pkg = require(path.join(root, "package.json"));

assert.ok(preload.includes('"card-pins-autoheight.js"'), "preload must install pinned-card/auto-height enhancement");
assert.ok(enhancement.includes("pinnedProviderCards"), "pinned-card order must persist in settings");
assert.ok(enhancement.includes("pinned-provider-group"), "pinned cards need a dedicated top group");
assert.ok(enhancement.includes("autoHeightToggle"), "display settings must expose an auto-height toggle");
assert.ok(enhancement.includes("manualWindowSize"), "auto-height toggle must preserve/clear manual height through existing resize state");
assert.ok(style.includes(".card-pin-button"), "pin control must have minimal card styling");
assert.ok(identity.includes("providerCardKey"), "account identity must follow cards by stable key after pin reordering");
assert.ok(pkg.scripts["test:renderer-layout"].includes("card-pins-autoheight-smoke.js"), "real Electron smoke must cover pin/auto-height UI");

console.log("card pin and auto-height static wiring tests passed");
