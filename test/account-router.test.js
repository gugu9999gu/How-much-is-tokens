const assert = require("assert");
const path = require("path");
const os = require("os");
const {
  ROUTABLE_PROVIDERS,
  normalizeSmartRouting,
  remainingPct,
  selectRoute,
  profileForSelection,
} = require("../lib/account-router");
const { normalizeAccountProfiles, profileInstanceKey } = require("../lib/account-profiles");

assert.deepStrictEqual(ROUTABLE_PROVIDERS, ["codex", "claude", "grok", "cursor", "copilot", "antigravity"]);

const settings = {
  accountProfiles: normalizeAccountProfiles([
    { providerId: "codex", label: "GPT 2번", configDir: path.join(os.tmpdir(), "router-codex-2") },
    { providerId: "codex", label: "GPT 3번", configDir: path.join(os.tmpdir(), "router-codex-3") },
    { providerId: "cursor", label: "Cursor 2번", configDir: path.join(os.tmpdir(), "router-cursor-2") },
    { providerId: "copilot", label: "Copilot 2번", configDir: path.join(os.tmpdir(), "router-copilot-2") },
  ]),
};

const providers = [
  { id: "codex", providerId: "codex", name: "Codex", accountLabel: "기본 계정", accountOrder: 0, status: "ok", remainingPct: 0 },
  { id: profileInstanceKey(settings.accountProfiles[0]), instanceKey: profileInstanceKey(settings.accountProfiles[0]), providerId: "codex", name: "Codex", accountLabel: "GPT 2번", accountOrder: 1, status: "ok", remainingPct: 63 },
  { id: profileInstanceKey(settings.accountProfiles[1]), instanceKey: profileInstanceKey(settings.accountProfiles[1]), providerId: "codex", name: "Codex", accountLabel: "GPT 3번", accountOrder: 2, status: "ok", remainingPct: 81 },
];

const defaults = normalizeSmartRouting();
for (const id of ROUTABLE_PROVIDERS) assert.strictEqual(defaults[id].enabled, false, `${id} routing must be opt-in`);
assert.strictEqual(defaults.codex.policy, "priority-fallback");
assert.strictEqual(defaults.codex.thresholdPct, 0);
assert.strictEqual(remainingPct({ remainingPct: null }), null, "unknown quota must not be coerced to zero");
assert.strictEqual(remainingPct({ remainingPct: "" }), null, "empty quota must remain unknown");
assert.strictEqual(remainingPct({
  id: "codex",
  remainingPct: 80,
  windows: [
    { id: "session", remainingPct: 80 },
    { id: "weekly", remainingPct: 0 },
  ],
}), 0, "Codex routing must stop on an exhausted global weekly quota even if the session gauge remains high");
assert.strictEqual(remainingPct({
  id: "claude",
  remainingPct: 80,
  windows: [
    { id: "session", remainingPct: 80 },
    { id: "weekly-all", remainingPct: 70 },
    { id: "weekly-scoped-fable", remainingPct: 0 },
  ],
}), 70, "Claude model-scoped meters such as Fable must not block generic account routing");
assert.strictEqual(remainingPct({ id: "claude", routingRemainingPct: 25, remainingPct: 80 }), 25);

const disabled = selectRoute("codex", providers, defaults);
assert.strictEqual(disabled.ok, false);
assert.strictEqual(disabled.reason, "disabled");

const priority = selectRoute("codex", providers, { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } });
assert.strictEqual(priority.ok, true);
assert.strictEqual(priority.accountLabel, "GPT 2번");
assert.strictEqual(priority.reason, "fallback");
assert.strictEqual(priority.remainingPct, 63);
assert.strictEqual(profileForSelection(settings, priority).label, "GPT 2번");

const maxRemaining = selectRoute("codex", providers, { codex: { enabled: true, policy: "max-remaining", thresholdPct: 0 } });
assert.strictEqual(maxRemaining.ok, true);
assert.strictEqual(maxRemaining.accountLabel, "GPT 3번");
assert.strictEqual(maxRemaining.remainingPct, 81);

const fixed = selectRoute("codex", providers, { codex: { enabled: true, policy: "fixed-primary", thresholdPct: 99 } });
assert.strictEqual(fixed.ok, true);
assert.strictEqual(fixed.accountLabel, "기본 계정");
assert.strictEqual(profileForSelection(settings, fixed), null);

const thresholded = selectRoute("codex", providers, { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 70 } });
assert.strictEqual(thresholded.ok, true);
assert.strictEqual(thresholded.accountLabel, "GPT 3번");

const staleProviders = providers.map((provider) => ({ ...provider }));
staleProviders[1].stale = true;
const staleSkipped = selectRoute("codex", staleProviders, { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } });
assert.strictEqual(staleSkipped.accountLabel, "GPT 3번");

const noUsable = selectRoute("codex", providers.map((provider) => ({ ...provider, remainingPct: 0 })), { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } });
assert.strictEqual(noUsable.ok, false);
assert.strictEqual(noUsable.reason, "no-usable-account");

const unknownFirst = providers.map((provider) => ({ ...provider }));
unknownFirst[1].remainingPct = null;
const unknownSkipped = selectRoute("codex", unknownFirst, { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } });
assert.strictEqual(unknownSkipped.accountLabel, "GPT 3번");

const reached = providers.map((provider) => ({ ...provider }));
reached[1].limitReached = true;
reached[2].remainingPct = 0;
assert.strictEqual(selectRoute("codex", reached, { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } }).ok, false);

const cursorProfile = settings.accountProfiles.find((profile) => profile.providerId === "cursor");
const cursorRows = [
  { id: "cursor", providerId: "cursor", accountOrder: 0, status: "ok", remainingPct: 4, accountLabel: "기본 계정" },
  { id: profileInstanceKey(cursorProfile), instanceKey: profileInstanceKey(cursorProfile), providerId: "cursor", accountOrder: 1, status: "ok", remainingPct: 72, accountLabel: "Cursor 2번" },
];
const cursorRoute = selectRoute("cursor", cursorRows, { cursor: { enabled: true, policy: "priority-fallback", thresholdPct: 5 } });
assert.strictEqual(cursorRoute.ok, true);
assert.strictEqual(cursorRoute.accountLabel, "Cursor 2번");
assert.strictEqual(profileForSelection(settings, cursorRoute).providerId, "cursor");

const copilotProfile = settings.accountProfiles.find((profile) => profile.providerId === "copilot");
const copilotRows = [
  { id: "copilot", providerId: "copilot", accountOrder: 0, status: "ok", remainingPct: 10 },
  { id: profileInstanceKey(copilotProfile), instanceKey: profileInstanceKey(copilotProfile), providerId: "copilot", accountOrder: 1, status: "ok", remainingPct: 85, accountLabel: "Copilot 2번" },
];
assert.strictEqual(selectRoute("copilot", copilotRows, { copilot: { enabled: true, policy: "max-remaining", thresholdPct: 0 } }).accountLabel, "Copilot 2번");

const agRows = [
  { id: "antigravity:a", providerId: "antigravity", profileId: "agm-a", externalAccountRef: "a@example.com", accountOrder: 0, accountLabel: "기본 계정", status: "ok", remainingPct: 0 },
  { id: "antigravity:b", providerId: "antigravity", profileId: "agm-b", externalAccountRef: "b@example.com", accountOrder: 1, accountLabel: "Antigravity 2", status: "ok", remainingPct: 61 },
];
const agRoute = selectRoute("antigravity", agRows, { antigravity: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } });
assert.strictEqual(agRoute.accountLabel, "Antigravity 2");
const agProfile = profileForSelection(settings, agRoute);
assert.strictEqual(agProfile.externalManager, "agm");
assert.strictEqual(agProfile.accountRef, "b@example.com");

console.log("smart account routing policy tests passed");
