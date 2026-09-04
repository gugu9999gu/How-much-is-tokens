const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  normalizeAccountProfiles,
  activeAccountProfiles,
  stableProfileId,
  profileInstanceKey,
  profileEnvironment,
} = require("../lib/account-profiles");
const { withAccountContext, profileMap } = require("../lib/usage");
const { providerCacheKey, saveProviderSnapshot, loadProviderSnapshot } = require("../lib/usage-cache");
const codex = require("../lib/providers/codex");
const claude = require("../lib/providers/claude");
const grok = require("../lib/providers/grok");

const root = path.join(os.tmpdir(), "how-much-is-tokens-multi-account-test");
const codexTwo = path.join(root, "codex-2");
const claudeWork = path.join(root, "claude-work");
const grokTwo = path.join(root, "grok-2");

const profiles = normalizeAccountProfiles([
  { providerId: "codex", label: "GPT 2번", configDir: codexTwo },
  { provider: "claude", label: "Claude | 업무", path: claudeWork },
  { providerId: "grok", label: "Grok 2번", configDir: grokTwo },
  { providerId: "grok", label: "duplicate", configDir: grokTwo },
  { providerId: "cursor", label: "unsupported", configDir: path.join(root, "cursor") },
  { providerId: "codex", label: "relative", configDir: "relative/profile" },
]);

assert.strictEqual(profiles.length, 3, "only supported absolute isolated profiles should survive normalization");
assert.deepStrictEqual(profiles.map((profile) => profile.providerId), ["codex", "claude", "grok"]);
assert.strictEqual(profiles[1].label, "Claude 업무", "profile labels must not contain the line-format separator");
assert.strictEqual(profiles[0].id, stableProfileId("codex", codexTwo));
assert.strictEqual(profileInstanceKey(profiles[0]), `codex:profile:${profiles[0].id}`);

const env = profileEnvironment(profiles[0]);
assert.strictEqual(env.CODEX_HOME, profiles[0].configDir);
assert.notStrictEqual(env, process.env, "explicit profile runtime must use an isolated environment object");

const oldCodexHome = process.env.CODEX_HOME;
process.env.CODEX_HOME = codexTwo;
try {
  const active = activeAccountProfiles({ accountProfiles: profiles });
  assert.ok(!active.some((profile) => profile.providerId === "codex"), "the current default CODEX_HOME must not be duplicated as another card");
  assert.strictEqual(active.length, 2);
} finally {
  if (oldCodexHome == null) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = oldCodexHome;
}

const map = profileMap({ accountProfiles: profiles });
assert.strictEqual(map.get("codex").length, 1);
assert.strictEqual(map.get("claude").length, 1);
assert.strictEqual(map.get("grok").length, 1);

const contextual = withAccountContext({
  id: "codex",
  name: "Codex",
  status: "ok",
  accountKey: "codex:actual-account",
}, profiles[0], null, 1);
assert.strictEqual(contextual.providerId, "codex");
assert.strictEqual(contextual.accountLabel, "GPT 2번");
assert.strictEqual(contextual.instanceKey, profileInstanceKey(profiles[0]));
assert.strictEqual(contextual.id, contextual.instanceKey, "profile cards need unique runtime ids for the main-process cache");
assert.strictEqual(providerCacheKey(contextual), contextual.instanceKey, "explicit profile cache isolation must win over accountKey");

assert.strictEqual(codex.authPath(profiles[0]), path.join(codexTwo, "auth.json"));
assert.strictEqual(claude.credentialsPath(profiles[1]), path.join(claudeWork, ".credentials.json"));
assert.strictEqual(grok.grokConfigDir(profiles[2]), grokTwo);

const cacheFile = path.join(root, "usage-cache.json");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const now = Date.now();
const accountA = {
  id: "codex:profile:aaaaaaaaaaaa",
  instanceKey: "codex:profile:aaaaaaaaaaaa",
  accountKey: "codex:same-upstream-key",
  accountLabel: "GPT 1번",
  name: "Codex",
  status: "ok",
  remainingPct: 80,
  windows: [{ id: "session", label: "5시간 한도", remainingPct: 80, usedPct: 20, resetAt: now + 60_000 }],
};
const accountB = {
  ...accountA,
  id: "codex:profile:bbbbbbbbbbbb",
  instanceKey: "codex:profile:bbbbbbbbbbbb",
  accountLabel: "GPT 2번",
  remainingPct: 15,
  windows: [{ id: "session", label: "5시간 한도", remainingPct: 15, usedPct: 85, resetAt: now + 60_000 }],
};
assert.strictEqual(saveProviderSnapshot(accountA, now, cacheFile), true);
assert.strictEqual(saveProviderSnapshot(accountB, now, cacheFile), true);
assert.strictEqual(loadProviderSnapshot(accountA, now + 1000, cacheFile).remainingPct, 80);
assert.strictEqual(loadProviderSnapshot(accountB, now + 1000, cacheFile).remainingPct, 15);
assert.strictEqual(loadProviderSnapshot({ id: "codex", instanceKey: "codex:profile:cccccccccccc" }, now + 1000, cacheFile), null,
  "an unknown explicit profile must never fall back to another account's legacy/provider snapshot");

fs.rmSync(root, { recursive: true, force: true });
console.log("multi-account profile isolation tests passed");
