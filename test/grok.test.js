const assert = require("assert");
const { parseBillingPayload, grokCreditBalances } = require("../lib/providers/grok");

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
    prepaidBalance: { val: 1250 },
    onDemandCap: { val: 5000 },
    onDemandUsed: { val: 300 },
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
assert.strictEqual(exhausted.creditBalances.length, 2);
const prepaid = exhausted.creditBalances.find((item) => item.id === "prepaid");
const onDemand = exhausted.creditBalances.find((item) => item.id === "on-demand");
assert.strictEqual(prepaid.balance, 12.5);
assert.strictEqual(prepaid.currency, "USD");
assert.strictEqual(onDemand.limit, 50);
assert.strictEqual(onDemand.used, 3);
assert.strictEqual(onDemand.balance, 47);
assert.strictEqual(onDemand.remainingPct, 94);
assert.strictEqual(onDemand.resetAt, Date.parse(reset));

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

const noCredits = grokCreditBalances({ creditUsagePercent: 10 });
assert.deepStrictEqual(noCredits, [], "credit rows must not be fabricated when xAI omits balance fields");

console.log("Grok shared-pool billing / credit tests passed");
