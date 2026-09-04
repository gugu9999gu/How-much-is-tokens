const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  hasGauge,
  sanitizeProvider,
  providerCacheKey,
  saveProviderSnapshot,
  loadProviderSnapshot,
  applyUsageFallback,
} = require("../lib/usage-cache");
const { stableAccountKey } = require("../lib/account-identity");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-much-is-tokens-cache-"));
const file = path.join(dir, "usage-cache.json");
const now = 1_800_000_000_000;
assert.strictEqual(hasGauge({ remainingPct: null, windows: [] }), false);
assert.strictEqual(hasGauge({ remainingPct: undefined, windows: [{ remainingPct: null }] }), false);
assert.strictEqual(hasGauge({ creditBalances: [{ id: "credit", balance: 12.5, currency: "USD" }] }), true);

const good = {
  id: "claude",
  name: "Claude",
  brand: "#d97757",
  status: "ok",
  plan: "max",
  remainingPct: 40,
  usedPct: 60,
  resetAt: now + 1_000,
  accessToken: "must-never-persist",
  windows: [
    { id: "five_hour", label: "5시간 한도", remainingPct: 40, usedPct: 60, resetAt: now + 1_000 },
    { id: "seven_day", label: "주간 한도", remainingPct: 70, usedPct: 30, resetAt: now + 86_400_000 },
  ],
  creditBalances: [
    { id: "usage-credits", label: "Usage Credits", balance: 37.5, used: 12.5, limit: 50, currency: "USD", remainingPct: 75 },
  ],
  extras: [{ label: "secret", value: "nope" }],
};

const sanitized = sanitizeProvider(good);
assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, "accessToken"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, "extras"), false);
assert.strictEqual(sanitized.creditBalances[0].balance, 37.5);
assert.strictEqual(saveProviderSnapshot(good, now, file), true);
assert.ok(!fs.readFileSync(file, "utf8").includes("must-never-persist"));

const afterFiveHourReset = loadProviderSnapshot("claude", now + 2_000, file);
assert.ok(afterFiveHourReset);
assert.deepStrictEqual(afterFiveHourReset.windows.map((win) => win.id), ["seven_day"]);
assert.strictEqual(afterFiveHourReset.remainingPct, 70);
assert.strictEqual(afterFiveHourReset.resetAt, now + 86_400_000);
assert.strictEqual(afterFiveHourReset.creditBalances[0].balance, 37.5);

const stale = applyUsageFallback({
  id: "claude",
  name: "Claude",
  status: "login",
  hint: "refresh auth",
}, now + 2_000, file);
assert.strictEqual(stale.status, "ok");
assert.strictEqual(stale.stale, true);
assert.strictEqual(stale.staleReason, "인증 갱신 대기");
assert.strictEqual(stale.liveStatus, "login");
assert.strictEqual(stale.remainingPct, 70);
assert.deepStrictEqual(stale.windows.map((win) => win.id), ["seven_day"]);
assert.strictEqual(stale.creditBalances[0].balance, 37.5);

const errorFallback = applyUsageFallback({
  id: "claude",
  name: "Claude",
  status: "error",
  error: "temporary network error",
}, now + 2_000, file);
assert.strictEqual(errorFallback.status, "ok");
assert.strictEqual(errorFallback.stale, true);
assert.strictEqual(errorFallback.staleReason, "사용량 조회 재시도 중");

const missing = applyUsageFallback({ id: "claude", name: "Claude", status: "missing" }, now + 2_000, file);
assert.strictEqual(missing.status, "missing", "explicit logout/missing credentials must not resurrect old account");

const afterAllResets = applyUsageFallback({ id: "claude", name: "Claude", status: "login" }, now + 90_000_000, file);
assert.ok(afterAllResets.status === "ok" || afterAllResets.status === "login");
if (afterAllResets.status === "ok") {
  assert.strictEqual(afterAllResets.windows.length, 0);
  assert.strictEqual(afterAllResets.creditBalances[0].balance, 37.5, "a non-resetting credit balance can remain within snapshot age");
}

// v1.0.17 and older saved Grok productUsage rows as independent remaining
// quotas. A stale fallback must keep only the real shared weekly quota.
const grokFile = path.join(dir, "grok-usage-cache.json");
fs.writeFileSync(grokFile, JSON.stringify({
  version: 1,
  providers: {
    grok: {
      savedAt: now,
      provider: {
        id: "grok",
        name: "Grok",
        status: "ok",
        remainingPct: 0,
        usedPct: 100,
        resetAt: now + 86_400_000,
        windows: [
          { id: "weekly", label: "주간", remainingPct: 0, usedPct: 100, resetAt: now + 86_400_000 },
          { id: "grokbuild", label: "GrokBuild", remainingPct: 5, usedPct: 95, resetAt: now + 86_400_000 },
          { id: "grokchat", label: "GrokChat", remainingPct: 97, usedPct: 3, resetAt: now + 86_400_000 },
          { id: "grokappbuilder", label: "GrokAppBuilder", remainingPct: 98, usedPct: 2, resetAt: now + 86_400_000 },
        ],
      },
    },
  },
}, null, 2));

const migratedGrok = loadProviderSnapshot("grok", now + 1_000, grokFile);
assert.ok(migratedGrok);
assert.deepStrictEqual(migratedGrok.windows.map((win) => win.id), ["weekly"]);
assert.strictEqual(migratedGrok.remainingPct, 0);
assert.strictEqual(migratedGrok.usedPct, 100);

// Multi-account foundation: the same provider must retain independent quota
// and credit snapshots. Stable keys are hashes; raw account IDs never become
// cache keys or persisted provider identity fields.
const accountFile = path.join(dir, "accounts-cache.json");
const accountA = stableAccountKey("codex", "raw-account-a@example.test");
const accountB = stableAccountKey("codex", "raw-account-b@example.test");
assert.notStrictEqual(accountA, accountB);
assert.ok(accountA.startsWith("codex:"));
assert.ok(!accountA.includes("raw-account-a"));
assert.strictEqual(providerCacheKey({ id: "codex", accountKey: accountA }), accountA);

const providerA = {
  id: "codex",
  accountKey: accountA,
  name: "Codex",
  status: "ok",
  remainingPct: 12,
  usedPct: 88,
  resetAt: now + 86_400_000,
  windows: [{ id: "weekly", label: "주간", remainingPct: 12, usedPct: 88, resetAt: now + 86_400_000 }],
  creditBalances: [{ id: "credits", label: "보유 크레딧", balance: 5, unit: "크레딧" }],
};
const providerB = {
  id: "codex",
  accountKey: accountB,
  name: "Codex",
  status: "ok",
  remainingPct: 83,
  usedPct: 17,
  resetAt: now + 86_400_000,
  windows: [{ id: "weekly", label: "주간", remainingPct: 83, usedPct: 17, resetAt: now + 86_400_000 }],
  creditBalances: [{ id: "credits", label: "보유 크레딧", balance: 20, unit: "크레딧" }],
};
assert.strictEqual(saveProviderSnapshot(providerA, now, accountFile), true);
assert.strictEqual(saveProviderSnapshot(providerB, now + 1, accountFile), true);
const storeText = fs.readFileSync(accountFile, "utf8");
assert.ok(storeText.includes(accountA));
assert.ok(storeText.includes(accountB));
assert.ok(!storeText.includes("raw-account-a@example.test"));
assert.ok(!storeText.includes("raw-account-b@example.test"));
const cachedA = loadProviderSnapshot({ id: "codex", accountKey: accountA }, now + 100, accountFile);
const cachedB = loadProviderSnapshot({ id: "codex", accountKey: accountB }, now + 100, accountFile);
assert.strictEqual(cachedA.remainingPct, 12);
assert.strictEqual(cachedA.creditBalances[0].balance, 5);
assert.strictEqual(cachedB.remainingPct, 83);
assert.strictEqual(cachedB.creditBalances[0].balance, 20);
const staleB = applyUsageFallback({ id: "codex", accountKey: accountB, name: "Codex", status: "error" }, now + 200, accountFile);
assert.strictEqual(staleB.remainingPct, 83, "account B must never inherit account A's cache");

fs.rmSync(dir, { recursive: true, force: true });
console.log("persistent usage / account-isolated credit cache tests passed");
