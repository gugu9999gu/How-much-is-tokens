const assert = require("assert");
const { parseBillingPayload } = require("../lib/providers/grok");

const reset = "2026-09-04T10:00:00Z";
const exhausted = parseBillingPayload({
  subscriptionTier: "SuperGrok",
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-08-28T10:00:00Z",
      end: reset,
    },
    creditUsagePercent: 100,
    productUsage: [
      { product: "GrokBuild", usagePercent: 95 },
      { product: "GrokChat", usagePercent: 3 },
      { product: "GrokAppBuilder", usagePercent: 2 },
    ],
  },
});

assert.strictEqual(exhausted.plan, "SuperGrok");
assert.strictEqual(exhausted.usedPct, 100);
assert.strictEqual(exhausted.remainingPct, 0);
assert.strictEqual(exhausted.windows.length, 1, "product rows must not become independent quota windows");
assert.strictEqual(exhausted.windows[0].id, "weekly");
assert.strictEqual(exhausted.windows[0].label, "주간 공유 한도");
assert.strictEqual(exhausted.windows[0].remainingPct, 0);
assert.deepStrictEqual(exhausted.extras, [
  { label: "GrokBuild", value: "사용 95%" },
  { label: "GrokChat", value: "사용 3%" },
  { label: "GrokAppBuilder", value: "사용 2%" },
]);
assert.ok(!exhausted.windows.some((win) => /grokchat|grokappbuilder|grokbuild/i.test(win.id)));

// Older/proxy payloads can omit the top-level percent while still reporting
// product usage. Product shares contribute to one shared pool, so summing them
// is the correct fallback for the pool utilization.
const productSumFallback = parseBillingPayload({
  config: {
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: reset },
    productUsage: [
      { product: "GrokBuild", usagePercent: 16 },
      { product: "GrokChat", usagePercent: 3 },
    ],
  },
});
assert.strictEqual(productSumFallback.usedPct, 19);
assert.strictEqual(productSumFallback.remainingPct, 81);
assert.strictEqual(productSumFallback.usageSource, "productUsage-sum");
assert.strictEqual(productSumFallback.windows.length, 1);

// Unified billing may omit both usage fields when the current period has no
// consumption yet. A valid period means zero used / 100 remaining.
const unusedPeriod = parseBillingPayload({
  config: {
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: reset },
  },
});
assert.strictEqual(unusedPeriod.usedPct, 0);
assert.strictEqual(unusedPeriod.remainingPct, 100);
assert.strictEqual(unusedPeriod.usageSource, "empty-current-period");

console.log("Grok shared-pool billing tests passed");
