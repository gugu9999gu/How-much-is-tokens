const assert = require("assert");
const {
  quotaWindow,
  premiumRequestBalance,
} = require("../lib/providers/copilot");

const resetAt = Date.parse("2026-10-01T00:00:00Z");
const snapshot = {
  entitlement: 300,
  remaining: 75,
  percent_remaining: 25,
};

const window = quotaWindow(snapshot, "premium", "프리미엄", resetAt);
assert.ok(window);
assert.strictEqual(window.remainingPct, 25);
assert.strictEqual(window.usedPct, 75);
assert.strictEqual(window.remaining, 75);
assert.strictEqual(window.entitlement, 300);

const balance = premiumRequestBalance(snapshot, resetAt);
assert.ok(balance);
assert.strictEqual(balance.label, "프리미엄 요청");
assert.strictEqual(balance.balance, 75);
assert.strictEqual(balance.used, 225);
assert.strictEqual(balance.limit, 300);
assert.strictEqual(balance.unit, "요청");
assert.strictEqual(balance.remainingPct, 25);
assert.strictEqual(balance.resetAt, resetAt);

const unlimited = premiumRequestBalance({ unlimited: true }, resetAt);
assert.ok(unlimited);
assert.strictEqual(unlimited.unlimited, true);
assert.strictEqual(unlimited.unit, "요청");
assert.strictEqual(unlimited.remainingPct, 100);

assert.strictEqual(premiumRequestBalance({ entitlement: 0, remaining: 0 }, resetAt), null);
assert.strictEqual(premiumRequestBalance({}, resetAt), null);

console.log("Copilot premium request balance tests passed");
