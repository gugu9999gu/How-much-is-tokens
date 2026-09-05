const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

// Build synthetic credentials at runtime so secret scanners do not mistake
// test fixtures for committed production credentials.
const API_SECRET = ["key", "openrouter", "default", "smoke"].join("-");
const MGMT_SECRET = ["key", "management", "default", "smoke"].join("-");
const PRIMARY_SECRET = ["key", "openrouter", "primary", "smoke"].join("-");
const BACKUP_SECRET = ["key", "openrouter", "backup", "smoke"].join("-");

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-much-is-tokens-secrets-"));
  app.setPath("userData", dir);

  const settings = require("../lib/settings");
  const secure = require("../lib/secure-secrets");

  assert.strictEqual(secure.encryptionAvailable(), true, "Windows runner must expose Electron safeStorage/DPAPI");

  // Backward-compatible single-key input becomes the secure default profile.
  const saved = settings.saveSettings({
    openRouterEnabled: true,
    openRouterApiKey: API_SECRET,
    openRouterManagementKey: MGMT_SECRET,
  });
  assert.strictEqual(saved.openRouterEnabled, true);
  assert.strictEqual(saved.openrouterApiKeyConfigured, true);
  assert.strictEqual(saved.openrouterManagementKeyConfigured, true);
  assert.ok(saved.openRouterProfiles.some((profile) => profile.id === "default"));
  assert.strictEqual(secure.getSecret("openrouterApiKey"), API_SECRET);
  assert.strictEqual(secure.getSecret("openrouterManagementKey"), MGMT_SECRET);
  assert.strictEqual(secure.loadOpenRouterProfileSecrets("default").apiKey, API_SECRET);

  settings.saveSettings({
    openRouterProfiles: [
      { id: "default", label: "기본 키", priority: 10, enabled: true },
      { id: "primary", label: "주 키", priority: 20, enabled: true },
      { id: "backup", label: "백업 키", priority: 30, enabled: true },
    ],
  });
  secure.saveOpenRouterProfileSecrets("primary", { apiKey: PRIMARY_SECRET });
  secure.saveOpenRouterProfileSecrets("backup", { apiKey: BACKUP_SECRET });

  assert.strictEqual(secure.loadOpenRouterProfileSecrets("primary").apiKey, PRIMARY_SECRET);
  assert.strictEqual(secure.loadOpenRouterProfileSecrets("backup").apiKey, BACKUP_SECRET);
  assert.notStrictEqual(
    secure.loadOpenRouterProfileSecrets("primary").apiKey,
    secure.loadOpenRouterProfileSecrets("backup").apiKey,
    "profile secrets must stay isolated",
  );

  const localToken = secure.ensureLocalRouterToken();
  assert.ok(typeof localToken === "string" && localToken.length >= 32, "local router token must be generated securely");
  assert.strictEqual(secure.ensureLocalRouterToken(), localToken, "local router token must be stable until explicitly replaced");

  let settingsRaw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  let secretsRaw = fs.readFileSync(path.join(dir, "secrets.json"), "utf8");
  for (const secret of [API_SECRET, MGMT_SECRET, PRIMARY_SECRET, BACKUP_SECRET, localToken]) {
    assert.ok(!settingsRaw.includes(secret), "settings.json must never contain raw secure values");
    assert.ok(!secretsRaw.includes(secret), "secrets.json must contain ciphertext only");
  }
  assert.ok(!settingsRaw.includes("openRouterApiKey"));
  assert.ok(!settingsRaw.includes("openRouterManagementKey"));

  // Direct secure-store mutation is intentionally lower-level than normal IPC.
  // Invalidate the display-only configured-status cache before reading settings.
  settings.invalidateSecretStatusCache();
  const status = settings.loadSettings();
  const primaryStatus = status.openRouterProfileStatuses.find((item) => item.id === "primary");
  const backupStatus = status.openRouterProfileStatuses.find((item) => item.id === "backup");
  assert.strictEqual(primaryStatus.apiKeyConfigured, true);
  assert.strictEqual(backupStatus.apiKeyConfigured, true);
  assert.strictEqual(status.openRouterLocalRouterTokenConfigured, true);

  // Removing a profile prunes its encrypted material rather than orphaning it.
  settings.saveSettings({
    openRouterProfiles: [
      { id: "default", label: "기본 키", priority: 10, enabled: true },
      { id: "primary", label: "주 키", priority: 20, enabled: true },
    ],
  });
  assert.strictEqual(secure.loadOpenRouterProfileSecrets("backup").apiKey, null);
  assert.strictEqual(secure.loadOpenRouterProfileSecrets("primary").apiKey, PRIMARY_SECRET);

  const cleared = settings.saveSettings({ clearOpenRouterSecrets: true });
  assert.strictEqual(cleared.openrouterApiKeyConfigured, false);
  assert.strictEqual(cleared.openrouterManagementKeyConfigured, false);
  assert.strictEqual(secure.getSecret("openrouterApiKey"), null);
  assert.strictEqual(secure.getSecret("openrouterManagementKey"), null);
  assert.strictEqual(secure.loadOpenRouterProfileSecrets("primary").apiKey, null);

  settingsRaw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  secretsRaw = fs.readFileSync(path.join(dir, "secrets.json"), "utf8");
  assert.ok(!settingsRaw.includes(localToken));
  assert.ok(!secretsRaw.includes(localToken));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Windows DPAPI multi-profile secret-store smoke test passed");
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
