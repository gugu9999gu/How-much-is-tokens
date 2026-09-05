const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

// Build synthetic credentials at runtime so secret scanners do not mistake
// test fixtures for committed production credentials.
const API_SECRET = ["sk", "or", "v1", "openrouter", "smoke", "secret"].join("-");
const MGMT_SECRET = ["sk", "or", "v1", "management", "smoke", "secret"].join("-");

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-much-is-tokens-secrets-"));
  app.setPath("userData", dir);

  const settings = require("../lib/settings");
  const secure = require("../lib/secure-secrets");

  assert.strictEqual(secure.encryptionAvailable(), true, "Windows runner must expose Electron safeStorage/DPAPI");

  const saved = settings.saveSettings({
    openRouterEnabled: true,
    openRouterApiKey: API_SECRET,
    openRouterManagementKey: MGMT_SECRET,
  });
  assert.strictEqual(saved.openRouterEnabled, true);
  assert.strictEqual(saved.openrouterApiKeyConfigured, true);
  assert.strictEqual(saved.openrouterManagementKeyConfigured, true);
  assert.strictEqual(secure.getSecret("openrouterApiKey"), API_SECRET);
  assert.strictEqual(secure.getSecret("openrouterManagementKey"), MGMT_SECRET);

  const settingsRaw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  const secretsRaw = fs.readFileSync(path.join(dir, "secrets.json"), "utf8");
  assert.ok(!settingsRaw.includes(API_SECRET));
  assert.ok(!settingsRaw.includes(MGMT_SECRET));
  assert.ok(!secretsRaw.includes(API_SECRET));
  assert.ok(!secretsRaw.includes(MGMT_SECRET));
  assert.ok(!settingsRaw.includes("openRouterApiKey"));
  assert.ok(!settingsRaw.includes("openRouterManagementKey"));

  const cleared = settings.saveSettings({ clearOpenRouterSecrets: true });
  assert.strictEqual(cleared.openrouterApiKeyConfigured, false);
  assert.strictEqual(cleared.openrouterManagementKeyConfigured, false);
  assert.strictEqual(secure.getSecret("openrouterApiKey"), null);
  assert.strictEqual(secure.getSecret("openrouterManagementKey"), null);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Windows DPAPI secure secret-store smoke test passed");
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
