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

    // One Admin key can observe multiple distinct API Key IDs. All credentials
    // stay encrypted, while the user-defined budget is non-secret settings data.
    const admin = ["admin", "fixture", "not", "real"].join("-");
    const keyOneId = "key_work_fixture";
    const keyTwoId = "key_personal_fixture";
    await assert.rejects(
      integration.createMediaProviderAccount("openai-api", {
        label: "Invalid Tracking ID",
        credentials: { adminKey: admin, apiKeyId: "sk-accidentally-pasted-secret" },
      }),
      /Tracking ID/,
      "A secret pasted in the Tracking ID input must be rejected before storage",
    );
    const trackedOne = await integration.createMediaProviderAccount("openai-api", {
      label: "GPT Tracking 1",
      credentials: { adminKey: admin, apiKeyId: keyOneId },
      monthlyBudgetUsd: 50.25,
    });
    assert.strictEqual(trackedOne.ok, true);
    assert.strictEqual(loadSettings().mediaProviderProfiles.find((p) => p.id === trackedOne.profileId && p.providerId === "openai-api").monthlyBudgetUsd, 50.25);
    const trackedTwo = await integration.createMediaProviderAccount("openai-api", {
      label: "GPT Tracking 2",
      credentials: { adminKey: admin, apiKeyId: keyTwoId },
      monthlyBudgetUsd: 20,
    });
    assert.strictEqual(trackedTwo.ok, true, "different Tracking IDs must be separate profiles even with the same Admin key");
    assert.notStrictEqual(trackedOne.profileId, trackedTwo.profileId);
    assert.strictEqual(loadMediaProviderProfileSecrets("openai-api", trackedTwo.profileId, ["apiKeyId"]).apiKeyId, keyTwoId);
    const trackingDuplicate = await integration.createMediaProviderAccount("openai-api", {
      label: "Duplicate Tracking ID",
      credentials: { adminKey: admin, apiKeyId: keyOneId },
    });
    assert.strictEqual(trackingDuplicate.reason, "duplicate-account");
    const changedBudget = integration.updateMediaProviderAccount("openai-api", trackedOne.profileId, { monthlyBudgetUsd: 70 });
    assert.strictEqual(changedBudget.ok, true, "monthly budget can be changed without replacing Admin key");
    assert.strictEqual(changedBudget.settings.mediaProviderProfiles.find((p) => p.id === trackedOne.profileId && p.providerId === "openai-api").monthlyBudgetUsd, 70);
    assert.throws(() => integration.updateMediaProviderAccount("openai-api", trackedOne.profileId, { monthlyBudgetUsd: -5 }), /월 예산/);
    const clearedBudget = integration.updateMediaProviderAccount("openai-api", trackedOne.profileId, { monthlyBudgetUsd: null });
    assert.strictEqual(clearedBudget.settings.mediaProviderProfiles.find((p) => p.id === trackedOne.profileId && p.providerId === "openai-api").monthlyBudgetUsd, null);
    assert.strictEqual(loadMediaProviderProfileSecrets("openai-api", trackedOne.profileId, ["adminKey"]).adminKey, admin);

    const settingsRaw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
    assert.ok(!settingsRaw.includes(KEY_ONE));
    assert.ok(!settingsRaw.includes(KEY_TWO));
    assert.ok(!settingsRaw.includes(KEY_MCP));
    assert.ok(!settingsRaw.includes(admin), "Admin key must never appear in settings.json");
    assert.ok(!settingsRaw.includes(keyOneId), "Tracking ID is stored with encrypted credentials");
    assert.ok(settingsRaw.includes('"monthlyBudgetUsd"'), "user budget should survive restart as non-secret setting");
    const secretsRaw = fs.readFileSync(secretsPath(), "utf8");
    assert.ok(!secretsRaw.includes(KEY_ONE), "safeStorage file must not contain plaintext API keys");
    assert.ok(!secretsRaw.includes(KEY_TWO));
    assert.ok(!secretsRaw.includes(KEY_MCP));
    assert.ok(!secretsRaw.includes(admin), "Admin key must be encrypted at rest");
    assert.ok(!secretsRaw.includes(keyOneId), "Tracking ID is encrypted with the credential");

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
