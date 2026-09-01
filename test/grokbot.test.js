const assert = require("assert");
const {
  cursorChecksum,
  parseSandUsage,
  parsePeriodUsage,
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
assert.ok(result.extras.some((item) => item.label === "On-demand 사용" && item.value === "$25.00"));
assert.ok(result.extras.some((item) => item.label === "On-demand 잔여" && item.value === "$75.00"));

console.log("grok bot provider tests passed");
