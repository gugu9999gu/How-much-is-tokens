const assert = require("assert");
const {
  moneyBalance,
  cursorCreditBalances,
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

console.log("Cursor credit balance tests passed");
