const assert = require("assert");
const {
  cursorChecksum,
  parseSandUsage,
  parsePeriodUsage,
  periodCreditBalance,
  resultFromPayloads,
} = require("../lib/providers/grokbot");
const { tokenFromCookie } = require("../lib/providers/cursor-auth");

const machineId = "12345678-1234-1234-1234-123456789abc";
const checksum = cursorChecksum(machineId, 1788235200000);
assert.ok(checksum.endsWith(machineId));
assert.ok(checksum.length > machineId.length);

const fakeToken = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdXRoMHwxMjM0NTYifQ.signature";
assert.strictEqual(tokenFromCookie(`123456%3A%3A${fakeToken}`), fakeToken);
assert.strictEqual(tokenFromCookie(`WorkosCursorSessionToken=123456%3A%3A${fakeToken}`), fakeToken);

const sand = parseSandUsage({
  usagePercent: 27.5,
  hasAvailableUsage: true,
  nextResetTimestampUtc: "2026-09-07T03:00:00Z",
});
assert.strictEqual(sand.usedPct, 27.5);
assert.strictEqual(sand.remainingPct, 72.5);
assert.strictEqual(sand.hasAvailableUsage, true);
assert.strictEqual(sand.resetAt, Date.parse("2026-09-07T03:00:00Z"));

const period = parsePeriodUsage({
  billingCycleEnd: "2026-10-01T00:00:00Z",
  membershipType: "ultra",
  spendLimitUsage: {
    individualUsed: 1234,
    individualLimit: 5000,
    individualRemaining: 3766,
  },
});
assert.strictEqual(period.used, 1234);
assert.strictEqual(period.limit, 5000);
assert.strictEqual(period.remaining, 3766);
assert.strictEqual(Math.round(period.usedPct * 100) / 100, 24.68);
assert.strictEqual(period.plan, "ultra");

const credit = periodCreditBalance(period);
assert.ok(credit);
assert.strictEqual(credit.used, 12.34);
assert.strictEqual(credit.limit, 50);
assert.strictEqual(credit.balance, 37.66);
assert.ok(Math.abs(credit.remainingPct - 75.32) < 0.001);
assert.strictEqual(credit.currency, "USD");

const result = resultFromPayloads(
  {
    usagePercent: 42,
    hasAvailableUsage: true,
    nextResetTimestampUtc: "2026-09-08T00:00:00Z",
  },
  {
    billingCycleEnd: "2026-10-01T00:00:00Z",
    membershipType: "ultra",
    spendLimitUsage: {
      individualUsed: 2500,
      individualLimit: 10000,
      individualRemaining: 7500,
    },
  },
);
assert.strictEqual(result.remainingPct, 58);
assert.strictEqual(result.windows.length, 2);
assert.strictEqual(result.windows[0].label, "주간");
assert.strictEqual(result.windows[1].label, "On-demand 한도");
assert.strictEqual(result.creditBalances.length, 1);
assert.strictEqual(result.creditBalances[0].label, "On-demand 크레딧");
assert.strictEqual(result.creditBalances[0].used, 25);
assert.strictEqual(result.creditBalances[0].limit, 100);
assert.strictEqual(result.creditBalances[0].balance, 75);
assert.ok(!result.extras.some((item) => /On-demand (사용|잔여|한도)/.test(item.label)), "money details must use the common credit model, not duplicate chips");
assert.ok(result.extras.some((item) => item.label === "계정" && item.value === "Cursor"));

assert.strictEqual(periodCreditBalance(null), null);
console.log("grok bot provider / credit tests passed");
