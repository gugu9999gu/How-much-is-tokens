const assert = require("assert");
const {
  structuredWindows,
  allUsageWindows,
  extraUsageCreditBalance,
  spendCreditBalance,
  creditBalances,
} = require("../lib/providers/claude");

const reset = "2026-09-11T00:00:00Z";
const structuredFixture = {
  limits: [
    {
      kind: "session",
      percent: 10,
      resets_at: "2026-09-04T15:00:00Z",
    },
    {
      kind: "weekly_all",
      percent: 20,
      resets_at: reset,
    },
    {
      kind: "weekly_scoped",
      percent: 30,
      resets_at: reset,
      scope: { model: { display_name: "Fable" } },
    },
    {
      kind: "weekly_scoped",
      percent: 40,
      resets_at: reset,
      scope: { model: { display_name: "Future Model" } },
    },
  ],
};

const structured = structuredWindows(structuredFixture);
assert.deepStrictEqual(structured.map((win) => win.label), [
  "세션 한도",
  "주간 한도",
  "Fable 주간 한도",
  "Future Model 주간 한도",
]);
assert.strictEqual(structured.find((win) => win.label === "Fable 주간 한도").remainingPct, 70);
assert.strictEqual(structured.find((win) => win.label === "Future Model 주간 한도").remainingPct, 60);
assert.ok(structured.every((win) => win.source === "claude-oauth-limits"));

const all = allUsageWindows({
  ...structuredFixture,
  five_hour: { utilization: 10, resets_at: "2026-09-04T15:00:00Z" },
  seven_day: { utilization: 20, resets_at: reset },
  seven_day_fable: { utilization: 30, resets_at: reset },
});
assert.strictEqual(all.filter((win) => /Fable/.test(win.label)).length, 1, "structured + flat Fable rows must deduplicate");
assert.strictEqual(all.filter((win) => win.label === "주간 한도").length, 1, "weekly compatibility row must deduplicate");

const noFable = allUsageWindows({
  limits: [
    { kind: "session", percent: 15, resets_at: reset },
    { kind: "weekly_all", percent: 25, resets_at: reset },
  ],
});
assert.ok(!noFable.some((win) => /fable/i.test(win.id) || /fable/i.test(win.label)), "Fable quota must never be fabricated");

// Future flat seven_day_* model rows should remain visible even before the
// application knows that model name explicitly.
const futureFlat = allUsageWindows({
  seven_day_nebula: {
    utilization: 12,
    resets_at: reset,
    display_name: "Nebula",
  },
});
assert.strictEqual(futureFlat.length, 1);
assert.strictEqual(futureFlat[0].label, "Nebula 주간 한도");
assert.strictEqual(futureFlat[0].remainingPct, 88);

const extra = extraUsageCreditBalance({
  is_enabled: true,
  monthly_limit: 5000,
  used_credits: 1250,
  utilization: 25,
  currency: "usd",
  resets_at: "2026-10-01T00:00:00Z",
});
assert.ok(extra);
assert.strictEqual(extra.label, "Usage Credits");
assert.strictEqual(extra.limit, 50);
assert.strictEqual(extra.used, 12.5);
assert.strictEqual(extra.balance, 37.5);
assert.strictEqual(extra.remainingPct, 75);
assert.strictEqual(extra.currency, "USD");

const spend = spendCreditBalance({
  used: { amount_minor: 1234, exponent: 2 },
  limit: { amount_minor: 5000, exponent: 2 },
  balance: { amount_minor: 3766, exponent: 2 },
  percent: 24.68,
  currency: "usd",
  resets_at: "2026-10-01T00:00:00Z",
});
assert.ok(spend);
assert.strictEqual(spend.used, 12.34);
assert.strictEqual(spend.limit, 50);
assert.strictEqual(spend.balance, 37.66);
assert.ok(Math.abs(spend.remainingPct - 75.32) < 0.001);

const preferred = creditBalances({
  spend: {
    used: { amount_minor: 100, exponent: 2 },
    limit: { amount_minor: 2000, exponent: 2 },
    balance: { amount_minor: 1900, exponent: 2 },
    currency: "usd",
  },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 9000,
    used_credits: 1000,
  },
});
assert.strictEqual(preferred.length, 1, "spend and extra_usage must not double-count the same credit pool");
assert.strictEqual(preferred[0].balance, 19);

console.log("Claude scoped quota / Fable / usage credit tests passed");
