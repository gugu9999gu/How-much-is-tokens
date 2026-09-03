const assert = require("assert");
const fs = require("fs");
const path = require("path");

const settingsSource = fs.readFileSync(path.join(__dirname, "..", "lib", "settings.js"), "utf8");
const secretSource = fs.readFileSync(path.join(__dirname, "..", "lib", "secure-secrets.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");

const defaultsBlock = settingsSource.slice(
  settingsSource.indexOf("const DEFAULTS ="),
  settingsSource.indexOf("function settingsPath"),
);
assert.ok(defaultsBlock.includes("openRouterEnabled: false"));
assert.ok(!defaultsBlock.includes("openRouterApiKey:"), "API key must not be part of settings.json defaults");
assert.ok(!defaultsBlock.includes("openRouterManagementKey:"), "management key must not be part of settings.json defaults");
assert.ok(settingsSource.includes("delete next[field]"), "secure input fields must be stripped before settings persistence");
assert.ok(settingsSource.includes("clearOpenRouterSecrets"));

assert.ok(secretSource.includes("safeStorage.encryptString"), "secret store must use Electron safeStorage encryption");
assert.ok(secretSource.includes("safeStorage.decryptString"));
assert.ok(secretSource.includes("throw new Error(\"운영체제 보안 저장소를 사용할 수 없습니다."), "must refuse plaintext fallback when secure storage is unavailable");
assert.ok(secretSource.includes("toString(\"base64\")"), "only encrypted bytes should be serialized");

assert.ok(html.includes('type="password" id="openRouterApiKey"'));
assert.ok(html.includes('type="password" id="openRouterManagementKey"'));
assert.ok(html.includes("OpenRouter 키 저장"));

console.log("OpenRouter secure storage tests passed");
