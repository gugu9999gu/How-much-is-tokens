const assert = require("assert");
const path = require("path");
const os = require("os");
const {
  normalizeSmartRouting,
  selectRoute,
  profileForSelection,
} = require("../lib/account-router");
const { normalizeAccountProfiles, profileInstanceKey } = require("../lib/account-profiles");

const settings = {
  accountProfiles: normalizeAccountProfiles([
    { providerId: "codex", label: "GPT 2번", configDir: path.join(os.tmpdir(), "router-codex-2") },
    { providerId: "codex", label: "GPT 3번", configDir: path.join(os.tmpdir(), "router-codex-3") },
  ]),
};

const providers = [
  {
    id: "codex",
    providerId: "codex",
    name: "Codex",
    accountLabel: "기본 계정",
    accountOrder: 0,
    status: "ok",
    remainingPct: 0,
  },
  {
    id: profileInstanceKey(settings.accountProfiles[0]),
    instanceKey: profileInstanceKey(settings.accountProfiles[0]),
    providerId: "codex",
    name: "Codex",
    accountLabel: "GPT 2번",
    accountOrder: 1,
    status: "ok",
    remainingPct: 63,
  },
  {
    id: profileInstanceKey(settings.accountProfiles[1]),
    instanceKey: profileInstanceKey(settings.accountProfiles[1]),
    providerId: "codex",
    name: "Codex",
    accountLabel: "GPT 3번",
    accountOrder: 2,
    status: "ok",
    remainingPct: 81,
  },
];

const defaults = normalizeSmartRouting();
assert.strictEqual(defaults.codex.enabled, false, "routing must be opt-in");
assert.strictEqual(defaults.codex.policy, "priority-fallback");
assert.strictEqual(defaults.codex.thresholdPct, 0);

const disabled = selectRoute("codex", providers, defaults);
assert.strictEqual(disabled.ok, false);
assert.strictEqual(disabled.reason, "disabled");

const priority = selectRoute("codex", providers, {
  codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 },
});
assert.strictEqual(priority.ok, true);
assert.strictEqual(priority.accountLabel, "GPT 2번");
assert.strictEqual(priority.reason, "fallback");
assert.strictEqual(priority.remainingPct, 63);
assert.strictEqual(profileForSelection(settings, priority).label, "GPT 2번");

const maxRemaining = selectRoute("codex", providers, {
  codex: { enabled: true, policy: "max-remaining", thresholdPct: 0 },
});
assert.strictEqual(maxRemaining.ok, true);
assert.strictEqual(maxRemaining.accountLabel, "GPT 3번");
assert.strictEqual(maxRemaining.remainingPct, 81);

const fixed = selectRoute("codex", providers, {
  codex: { enabled: true, policy: "fixed-primary", thresholdPct: 99 },
});
assert.strictEqual(fixed.ok, true, "fixed-primary is explicit user intent and does not apply the threshold");
assert.strictEqual(fixed.accountLabel, "기본 계정");
assert.strictEqual(profileForSelection(settings, fixed), null);

const thresholded = selectRoute("codex", providers, {
  codex: { enabled: true, policy: "priority-fallback", thresholdPct: 70 },
});
assert.strictEqual(thresholded.ok, true);
assert.strictEqual(thresholded.accountLabel, "GPT 3번");

const staleProviders = providers.map((provider) => ({ ...provider }));
staleProviders[1].stale = true;
const staleSkipped = selectRoute("codex", staleProviders, {
  codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 },
});
assert.strictEqual(staleSkipped.accountLabel, "GPT 3번", "automatic routing must skip stale account data");

const noUsable = selectRoute("codex", providers.map((provider) => ({ ...provider, remainingPct: 0 })), {
  codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 },
});
assert.strictEqual(noUsable.ok, false);
assert.strictEqual(noUsable.reason, "no-usable-account");

const reached = providers.map((provider) => ({ ...provider }));
reached[1].limitReached = true;
reached[2].remainingPct = 0;
const reachedSkipped = selectRoute("codex", reached, {
  codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 },
});
assert.strictEqual(reachedSkipped.ok, false, "server-classified limit reached accounts must not be auto-selected");

console.log("smart account routing policy tests passed");
