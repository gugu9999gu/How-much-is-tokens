const assert = require("assert");
const os = require("os");
const path = require("path");
const { normalizeSettings } = require("../lib/settings");
const { profileAutoResetEnabled } = require("../lib/providers/codex");

const settings = normalizeSettings({
  codexAutoUseReset: true,
  accountProfiles: [
    { providerId: "codex", label: "Codex 2", configDir: path.join(os.tmpdir(), "codex-reset-2") },
    { providerId: "codex", label: "Codex 3", configDir: path.join(os.tmpdir(), "codex-reset-3") },
  ],
});
const [two, three] = settings.accountProfiles;
assert.strictEqual(profileAutoResetEnabled(settings, null), true, "default account follows the existing global opt-in");
assert.strictEqual(profileAutoResetEnabled(settings, two), false, "extra accounts remain off until explicitly enabled");

const opted = normalizeSettings({
  ...settings,
  codexAutoResetProfiles: [two.id, "unknown-profile"],
});
assert.deepStrictEqual(opted.codexAutoResetProfiles, [two.id], "unknown profile IDs must be discarded");
assert.strictEqual(profileAutoResetEnabled(opted, two), true);
assert.strictEqual(profileAutoResetEnabled(opted, three), false);

const removed = normalizeSettings({
  ...opted,
  accountProfiles: [three],
});
assert.deepStrictEqual(removed.codexAutoResetProfiles, [], "removing an account must also remove its destructive automation opt-in");

console.log("per-account Codex reset-ticket settings tests passed");
