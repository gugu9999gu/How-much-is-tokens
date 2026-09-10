const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-openrouter-profile-"));
app.setPath("userData", dir);

app.whenReady().then(async () => {
  const integration = require("../lib/openrouter-main-integration");
  try {
    const firstKey = ["fixture", "openrouter", "manual", "one"].join("-");
    const firstManagement = ["fixture", "openrouter", "management", "one"].join("-");
    const first = await integration.createTrackedOpenRouterProfile({
      label: "업무 키",
      apiKey: firstKey,
      managementKey: firstManagement,
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.profileId, "default");
    assert.strictEqual(first.settings.openRouterEnabled, true);
    assert.strictEqual(first.settings.openRouterProfiles.length, 1);
    assert.strictEqual(first.settings.openRouterProfiles[0].label, "업무 키");
    assert.strictEqual(first.settings.openRouterProfileStatuses[0].apiKeyConfigured, true);
    assert.strictEqual(first.settings.openRouterProfileStatuses[0].managementKeyConfigured, true);

    const duplicate = await integration.createTrackedOpenRouterProfile({
      label: "중복",
      apiKey: firstKey,
    });
    assert.strictEqual(duplicate.ok, false);
    assert.strictEqual(duplicate.reason, "duplicate-key");
    assert.strictEqual(duplicate.profileId, "default");

    const second = await integration.createTrackedOpenRouterProfile({
      label: "백업 키",
      apiKey: ["fixture", "openrouter", "manual", "two"].join("-"),
    });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.settings.openRouterProfiles.length, 2, "different API keys must be trackable even when they may belong to the same upstream account");
    assert.strictEqual(second.settings.openRouterProfiles[1].priority, 20);

    const secretPath = path.join(dir, "secrets.json");
    const encryptedStore = fs.readFileSync(secretPath, "utf8");
    assert.ok(!encryptedStore.includes(firstKey), "raw API key must never be persisted");
    assert.ok(!encryptedStore.includes(firstManagement), "raw Management Key must never be persisted");

    const removed = await integration.deleteOpenRouterProfile("default");
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(removed.settings.openRouterProfiles.length, 1);
    assert.ok(!removed.settings.openRouterProfileStatuses.some((status) => status.id === "default"), "deleting a profile must prune its encrypted secret status");

    console.log("OpenRouter tracked profile secure-storage smoke test passed");
    await integration.router.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    try {
      const integration = require("../lib/openrouter-main-integration");
      await integration.router.stop();
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(1);
  }
});
