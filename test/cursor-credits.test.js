const assert = require("assert");
const {
  moneyBalance,
  cursorCreditBalances,
  cursorQuotaWindows,
  cursorBonusCents,
} = require("../lib/providers/cursor");

const resetAt = Date.parse("2026-10-01T00:00:00Z");
const included = moneyBalance({
  used: 1516,
  limit: 2000,
  remaining: 484,
}, "included", "포함 크레딧", resetAt);
assert.ok(included);
assert.strictEqual(included.used, 15.16);
assert.strictEqual(included.limit, 20);
assert.strictEqual(included.balance, 4.84);
assert.strictEqual(included.remainingPct, 24.2);
assert.strictEqual(included.currency, "USD");

const computed = moneyBalance({
  enabled: true,
  used: 725,
  limit: 5000,
}, "on-demand", "On-demand", resetAt);
assert.strictEqual(computed.used, 7.25);
assert.strictEqual(computed.limit, 50);
assert.strictEqual(computed.balance, 42.75);
assert.strictEqual(computed.remainingPct, 85.5);

assert.strictEqual(
  moneyBalance({ enabled: false, used: 0, limit: 0, remaining: 0 }, "off", "Off", resetAt),
  null,
  "disabled on-demand pool must not create a fake zero balance",
);

const balances = cursorCreditBalances({
  individualUsage: {
    plan: { used: 1516, limit: 2000, remaining: 484 },
    onDemand: { enabled: true, used: 250, limit: 2500, remaining: 2250 },
  },
  teamUsage: {
    pooled: { enabled: true, used: 10000, limit: 50000, remaining: 40000 },
    onDemand: { enabled: false, used: 0, limit: 0, remaining: 0 },
  },
}, resetAt);
assert.deepStrictEqual(balances.map((item) => item.id), ["included", "on-demand", "team-pooled"]);
assert.strictEqual(balances[1].balance, 22.5);
assert.strictEqual(balances[2].balance, 400);
assert.ok(balances.every((item) => item.resetAt === resetAt));

assert.deepStrictEqual(cursorCreditBalances({}, resetAt), [], "missing money data must not fabricate credits");

const exhausted = cursorQuotaWindows({
  individualUsage: {
    plan: {
      used: 40000,
      limit: 40000,
      remaining: 0,
      breakdown: { included: 40000, bonus: 12728, total: 52728 },
      autoPercentUsed: 15.23,
      apiPercentUsed: 56.62,
      totalPercentUsed: 16.88,
    },
  },
}, resetAt);
assert.deepStrictEqual(exhausted.map((win) => win.id), ["included", "auto", "api"]);
assert.strictEqual(exhausted[0].label, "포함 사용량");
assert.strictEqual(exhausted[0].remainingPct, 0);
assert.strictEqual(exhausted[0].usedPct, 100);
assert.ok(Math.abs(exhausted[1].remainingPct - 84.77) < 0.001);
assert.ok(Math.abs(exhausted[2].remainingPct - 43.38) < 0.001);
assert.ok(!exhausted.some((win) => win.id === "total"), "an exhausted included allowance must not be hidden behind totalPercentUsed");
assert.strictEqual(cursorBonusCents({ individualUsage: { plan: { breakdown: { bonus: 12728 } } } }), 12728);

const partial = cursorQuotaWindows({
  individualUsage: {
    plan: {
      used: 26848,
      limit: 40000,
      remaining: 13152,
      autoPercentUsed: 6.7,
      apiPercentUsed: 53.85,
      totalPercentUsed: 8.59,
    },
  },
}, resetAt);
assert.strictEqual(partial[0].id, "included");
assert.ok(Math.abs(partial[0].remainingPct - 32.88) < 0.001, "included remaining must follow remaining/limit, not totalPercentUsed");

const percentOnly = cursorQuotaWindows({
  individualUsage: {
    plan: {
      used: 0,
      limit: 0,
      remaining: 0,
      totalPercentUsed: 40,
      autoPercentUsed: 10,
      apiPercentUsed: 70,
    },
  },
}, resetAt);
assert.deepStrictEqual(percentOnly.map((win) => win.id), ["total", "auto", "api"]);
assert.strictEqual(percentOnly[0].remainingPct, 60);

console.log("Cursor credit balance tests passed");
