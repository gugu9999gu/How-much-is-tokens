const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  hasGauge,
  sanitizeProvider,
  saveProviderSnapshot,
  loadProviderSnapshot,
  applyUsageFallback,
} = require("../lib/usage-cache");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-much-is-tokens-cache-"));
const file = path.join(dir, "usage-cache.json");
const now = 1_800_000_000_000;
assert.strictEqual(hasGauge({ remainingPct: null, windows: [] }), false);
assert.strictEqual(hasGauge({ remainingPct: undefined, windows: [{ remainingPct: null }] }), false);

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
  extras: [{ label: "secret", value: "nope" }],
};

const sanitized = sanitizeProvider(good);
assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, "accessToken"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, "extras"), false);
assert.strictEqual(saveProviderSnapshot(good, now, file), true);
assert.ok(!fs.readFileSync(file, "utf8").includes("must-never-persist"));

const afterFiveHourReset = loadProviderSnapshot("claude", now + 2_000, file);
assert.ok(afterFiveHourReset);
assert.deepStrictEqual(afterFiveHourReset.windows.map((win) => win.id), ["seven_day"]);
assert.strictEqual(afterFiveHourReset.remainingPct, 70);
assert.strictEqual(afterFiveHourReset.resetAt, now + 86_400_000);

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
assert.strictEqual(afterAllResets.status, "login", "expired quota snapshots must not be shown as current gauges");

// v1.0.17 and older saved Grok productUsage rows as independent remaining
// quotas. A stale fallback on v1.0.18 must keep only the real shared weekly
// quota and discard misleading GrokChat/GrokAppBuilder/GrokBuild windows.
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

fs.rmSync(dir, { recursive: true, force: true });
console.log("persistent usage cache tests passed");
