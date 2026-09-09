const assert = require("assert");
const path = require("path");
const {
  disabledDefaultProviders,
  defaultProviderDisabled,
  withAccountContext,
} = require("../lib/usage");
const { normalizeDisabledCredentialProviders } = require("../lib/settings");

assert.deepStrictEqual(
  normalizeDisabledCredentialProviders(["cursor", "CODEX", "unknown", "cursor"]),
  ["codex", "cursor"],
);
assert.deepStrictEqual([...disabledDefaultProviders({ disabledCredentialProviders: ["codex", "grokbot"] })].sort(), ["codex", "grokbot"]);
assert.strictEqual(defaultProviderDisabled({ disabledCredentialProviders: ["codex"] }, "codex"), true);
assert.strictEqual(defaultProviderDisabled({ disabledCredentialProviders: ["cursor"] }, "grokbot"), true, "Cursor disconnect must also hide the shared-auth Grok Bot default");
assert.strictEqual(defaultProviderDisabled({ disabledCredentialProviders: ["grokbot"] }, "cursor"), false, "Grok Bot can be hidden without hiding Cursor");
assert.strictEqual(defaultProviderDisabled({ disabledCredentialProviders: [] }, "claude"), false);

const profile = {
  id: "profile123",
  providerId: "codex",
  label: "Codex 2",
  configDir: path.resolve("test-profile"),
};
const decorated = withAccountContext({ id: "codex", name: "Codex", status: "ok", remainingPct: 80 }, profile, null, 2);
assert.strictEqual(decorated.profileId, "profile123", "usage rows must carry profileId so one account can be disconnected precisely");
assert.strictEqual(decorated.accountLabel, "Codex 2");
assert.strictEqual(decorated.accountOrder, 2);

console.log("credential disconnect state tests passed");
