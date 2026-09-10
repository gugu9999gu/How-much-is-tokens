const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

const KEY_ONE = ["fal", "profile", "one", "fixture"].join("-");
const KEY_TWO = ["fal", "profile", "two", "fixture"].join("-");
const KEY_MCP = ["fal", "mcp", "profile", "fixture"].join("-");

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-media-profiles-"));
  app.setPath("userData", dir);
  try {
    const integration = require("../lib/api-providers-main-integration");
    const { loadSettings } = require("../lib/settings");
    const { loadMediaProviderProfileSecrets, secretsPath } = require("../lib/secure-secrets");

    const first = await integration.createMediaProviderAccount("falai", {
      label: "Fal Work",
      mode: "api",
      credentials: { apiKey: KEY_ONE },
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.mode, "api");
    assert.ok(first.profileId);
    assert.strictEqual(loadMediaProviderProfileSecrets("falai", first.profileId, ["apiKey"]).apiKey, KEY_ONE);

    const duplicate = await integration.createMediaProviderAccount("falai", {
      label: "Duplicate",
      mode: "api",
      credentials: { apiKey: KEY_ONE },
    });
    assert.strictEqual(duplicate.ok, false);
    assert.strictEqual(duplicate.reason, "duplicate-account");

    const second = await integration.createMediaProviderAccount("falai", {
      label: "Fal Personal",
      mode: "api",
      credentials: { apiKey: KEY_TWO },
    });
    assert.strictEqual(second.ok, true, "a different API key must be trackable as another account profile");

    const mcp = await integration.createMediaProviderAccount("falai", {
      label: "Fal MCP",
      mode: "mcp",
      credentials: { apiKey: KEY_MCP },
    });
    assert.strictEqual(mcp.ok, true);
    const mcpProfile = loadSettings().mediaProviderProfiles.find((profile) => profile.id === mcp.profileId);
    assert.strictEqual(mcpProfile.mode, "mcp");

    const unsupported = await integration.createMediaProviderAccount("stability", {
      label: "Bad MCP",
      mode: "mcp",
      credentials: { apiKey: "not-a-real-key" },
    });
    assert.strictEqual(unsupported.ok, false);
    assert.strictEqual(unsupported.reason, "mcp-not-supported");

    const settingsRaw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
    assert.ok(!settingsRaw.includes(KEY_ONE));
    assert.ok(!settingsRaw.includes(KEY_TWO));
    assert.ok(!settingsRaw.includes(KEY_MCP));
    const secretsRaw = fs.readFileSync(secretsPath(), "utf8");
    assert.ok(!secretsRaw.includes(KEY_ONE), "safeStorage file must not contain plaintext API keys");
    assert.ok(!secretsRaw.includes(KEY_TWO));
    assert.ok(!secretsRaw.includes(KEY_MCP));

    const statuses = loadSettings().mediaProviderProfileStatuses;
    assert.ok(statuses.some((row) => row.providerId === "falai" && row.id === first.profileId && row.fields.apiKey));
    assert.ok(statuses.some((row) => row.providerId === "falai" && row.id === mcp.profileId && row.fields.apiKey));

    const removed = integration.removeMediaProviderAccount("falai", first.profileId);
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(loadMediaProviderProfileSecrets("falai", first.profileId, ["apiKey"]).apiKey, null);
    assert.ok(!loadSettings().mediaProviderProfiles.some((profile) => profile.id === first.profileId));

    console.log("media provider secure account smoke test passed");
    fs.rmSync(dir, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(1);
  }
});
