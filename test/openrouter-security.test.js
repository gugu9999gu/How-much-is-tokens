const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(root, "lib", "settings.js"), "utf8");
const secretSource = fs.readFileSync(path.join(root, "lib", "secure-secrets.js"), "utf8");
const routerSource = fs.readFileSync(path.join(root, "lib", "openrouter-request-router.js"), "utf8");
const integrationSource = fs.readFileSync(path.join(root, "lib", "openrouter-main-integration.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");

const defaultsBlock = settingsSource.slice(
  settingsSource.indexOf("const DEFAULTS ="),
  settingsSource.indexOf("function settingsPath"),
);
assert.ok(defaultsBlock.includes("openRouterEnabled: false"));
assert.ok(defaultsBlock.includes("openRouterProfiles: []"));
assert.ok(defaultsBlock.includes("openRouterRouter: normalizeOpenRouterRouter()"));
assert.ok(!defaultsBlock.includes("openRouterApiKey:"), "API key must not be part of settings.json defaults");
assert.ok(!defaultsBlock.includes("openRouterManagementKey:"), "management key must not be part of settings.json defaults");
assert.ok(settingsSource.includes("for (const field of SECURE_INPUT_FIELDS) delete next[field]"));
assert.ok(settingsSource.includes("migrateLegacyOpenRouterSecrets(\"default\")"), "legacy single-key data must migrate to default profile");
assert.ok(settingsSource.includes("pruneOpenRouterProfileSecrets"), "removed profiles must not leave orphaned ciphertext");

assert.ok(secretSource.includes("safeStorage.encryptString"), "secret store must use Electron safeStorage encryption");
assert.ok(secretSource.includes("safeStorage.decryptString"));
assert.ok(secretSource.includes("openrouterProfile:${id}:${kind}"), "profile secrets must use isolated names");
assert.ok(secretSource.includes("crypto.randomBytes(32)"), "local router auth token must use CSPRNG bytes");
assert.ok(secretSource.includes("LOCAL_ROUTER_TOKEN"));
assert.ok(secretSource.includes("평문으로 저장하지 않습니다"), "must refuse plaintext fallback when secure storage is unavailable");
assert.ok(secretSource.includes("toString(\"base64\")"), "only encrypted bytes should be serialized");

assert.ok(routerSource.includes('const LOOPBACK_HOST = "127.0.0.1"'));
assert.ok(routerSource.includes("server.listen(port, LOOPBACK_HOST"), "router must bind to explicit loopback only");
assert.ok(!routerSource.includes('listen(port, "0.0.0.0"'));
assert.ok(!routerSource.includes('listen(port, "::"'));
assert.ok(routerSource.includes("crypto.timingSafeEqual"), "local Bearer token comparison must be timing-safe");
assert.ok(routerSource.includes('headers.authorization = `Bearer ${candidate.apiKey}`'), "client auth must be replaced with selected upstream key");
assert.ok(routerSource.includes("RETRYABLE_STATUSES"));
assert.ok(routerSource.includes("all_openrouter_keys_unavailable"));
assert.ok(routerSource.includes("Readable.fromWeb(upstream.body)"), "streaming upstream body must be proxied without buffering the whole response");
assert.ok(!/console\.(log|info|debug)\s*\(/.test(routerSource), "router must not log request bodies or Authorization values");

assert.ok(mainSource.includes('require("./lib/openrouter-main-integration")'), "Electron main must install router IPC/lifecycle integration");
assert.ok(integrationSource.includes('clipboard.writeText(token)'), "raw local auth token should be copied in main, not returned to renderer");
assert.ok(preloadSource.includes("copyOpenRouterRouterToken"));
assert.ok(!preloadSource.includes("getOpenRouterRouterToken"), "renderer must not get a raw token-returning API");

for (const id of [
  "openRouterProfiles",
  "openRouterProfileSelect",
  "openRouterApiKey",
  "openRouterManagementKey",
  "openRouterRouterEnabled",
  "openRouterRouterPort",
  "openRouterRouterPolicy",
  "openRouterRouterEndpoint",
  "copyOpenRouterRouterToken",
]) {
  assert.ok(html.includes(`id="${id}"`), `missing OpenRouter v1.0.24 control: ${id}`);
}
assert.ok(html.includes("127.0.0.1:43123/v1"));
assert.ok(html.includes('type="password" id="openRouterApiKey"'));
assert.ok(html.includes('type="password" id="openRouterManagementKey"'));

console.log("OpenRouter multi-profile / localhost router security tests passed");
