const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { DEFAULTS, VISUALIZATION_MODES, normalizeSettings } = require("../lib/settings");

assert.deepStrictEqual(VISUALIZATION_MODES, ["ring", "bar", "number"]);
assert.strictEqual(DEFAULTS.visualization, "ring");
assert.strictEqual(normalizeSettings({ visualization: "bar" }).visualization, "bar");
assert.strictEqual(normalizeSettings({ visualization: "number" }).visualization, "number");
assert.strictEqual(normalizeSettings({ visualization: "unknown" }).visualization, "ring");

const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
for (const mode of VISUALIZATION_MODES) {
  assert.ok(html.includes(`name="visualization" value="${mode}"`), `missing visualization option: ${mode}`);
}

const app = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
assert.ok(app.includes("renderQuotaRing"));
assert.ok(app.includes("renderQuotaBar"));
assert.ok(app.includes("renderQuotaNumber"));
assert.ok(app.includes("saveSettings({ visualization })"));

console.log("visualization mode tests passed");
