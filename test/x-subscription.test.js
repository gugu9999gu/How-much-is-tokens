const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  describePlan,
  formatPlanLabel,
  isXSubscription,
} = require("../lib/x-subscription");
const { cursorQuotaWindows, cursorCreditBalances } = require("../lib/providers/cursor");
const { parseBillingPayload } = require("../lib/providers/grok");
const { resultFromPayloads } = require("../lib/providers/grokbot");

const badgeLimit = 22;
const renderer = fs.readFileSync(path.join(__dirname, "../renderer/app.js"), "utf8");
assert.ok(renderer.includes("if (text.length > 22) return \"\";"), "plan badges longer than 22 characters are hidden");

const labels = {
  free: "Free · $0 · Limited",
  plus: "Plus · $8 · Base",
  premium: "Premium · $30 · 4x",
  super: "Super · $100 · 15x",
  pro: "Pro · $20",
  "pro+": "Pro+ · $60",
  "pro plus": "Pro+ · $60",
  hobby: "Hobby · $0",
  start: "Start · ₹649",
  "teams standard": "Teams Standard · $40/인",
  "teams premium": "Teams Premium · $120/인",
  ultra: "ultra",
  Ultra: "Ultra",
  SuperGrok: "SuperGrok",
  "SuperGrok Lite": "SuperGrok Lite",
};

for (const [raw, expected] of Object.entries(labels)) {
  const label = formatPlanLabel(raw);
  assert.strictEqual(label, expected, raw);
  assert.ok(label.length <= badgeLimit, `${raw} badge is hidden when longer than ${badgeLimit}: ${label}`);
}

assert.strictEqual(describePlan("plus").annualUsd, 80);
assert.strictEqual(describePlan("plus").annualMonthlyUsd, 7);
assert.strictEqual(describePlan("plus").grokBotIncluded, false);
assert.strictEqual(describePlan("premium").annualUsd, 300);
assert.strictEqual(describePlan("premium").annualMonthlyUsd, 25);
assert.strictEqual(describePlan("premium").included, "4x Plus");
assert.strictEqual(describePlan("premium").grokBotIncluded, true);
assert.strictEqual(describePlan("premium").thirdPartyIncluded, false);
assert.strictEqual(describePlan("super").monthlyUsd, 100);
assert.strictEqual(describePlan("super").annualUsd, 1000);
assert.strictEqual(describePlan("super").annualMonthlyUsd, 84);
assert.strictEqual(describePlan("super").included, "15x Plus");
assert.strictEqual(describePlan("ultra").family, "ambiguous");
assert.strictEqual(describePlan("ultra").monthlyUsd, 200);
assert.strictEqual(describePlan("ultra").xSubscription.annualUsd, 2000);
assert.strictEqual(describePlan("ultra").xSubscription.annualMonthlyUsd, 167);
assert.strictEqual(describePlan("ultra").xSubscription.included, "50x Plus");
assert.strictEqual(describePlan("ultra").legacyCursor.monthlyUsd, 200);
assert.strictEqual(describePlan("SuperGrok").family, "legacy-grok");
assert.strictEqual(isXSubscription("super"), true);
assert.strictEqual(isXSubscription("SuperGrok"), false);
assert.strictEqual(describePlan("start").monthlyInr, 649);
assert.strictEqual(describePlan("start").taxInclusive, true);
assert.strictEqual(describePlan("cursor pro").monthlyUsd, 20);

const resetAt = Date.parse("2026-10-01T00:00:00Z");
const premiumWindows = cursorQuotaWindows({
  membershipType: "premium",
  individualUsage: {
    plan: {
      used: 0,
      limit: 0,
      remaining: 0,
      autoPercentUsed: 12,
      apiPercentUsed: 40,
      totalPercentUsed: 12,
    },
  },
}, resetAt);
assert.deepStrictEqual(premiumWindows.map((win) => win.id), ["total", "auto"]);
assert.ok(!premiumWindows.some((win) => win.id === "api"), "X Subscription must not show Other Models as included usage");

const premiumBalances = cursorCreditBalances({
  membershipType: "premium",
  individualUsage: {
    onDemand: { enabled: true, used: 100, limit: 500, remaining: 400 },
  },
}, resetAt);
assert.strictEqual(premiumBalances[0].label, "추가 사용");

const legacyWindows = cursorQuotaWindows({
  membershipType: "pro",
  individualUsage: {
    plan: { autoPercentUsed: 10, apiPercentUsed: 20 },
  },
}, resetAt);
assert.deepStrictEqual(legacyWindows.map((win) => win.id), ["auto", "api"]);

const grokPremium = parseBillingPayload({
  subscriptionTier: "Premium",
  config: {
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-10-26T00:00:00Z" },
    creditUsagePercent: 25,
    onDemandCap: { val: 2000 },
    onDemandUsed: { val: 500 },
  },
});
assert.strictEqual(grokPremium.plan, "Premium · $30 · 4x");
assert.strictEqual(grokPremium.windows[0].label, "공유 주간 한도");
assert.strictEqual(grokPremium.creditBalances.find((item) => item.id === "on-demand").label, "추가 사용");

const grokBotPremium = resultFromPayloads(
  { usagePercent: 10, hasAvailableUsage: true, nextResetTimestampUtc: "2026-11-02T00:00:00Z" },
  {
    billingCycleEnd: "2026-11-20T00:00:00Z",
    membershipType: "premium",
    spendLimitUsage: { individualUsed: 100, individualLimit: 1000, individualRemaining: 900 },
  },
);
assert.strictEqual(grokBotPremium.plan, "Premium · $30 · 4x");
assert.strictEqual(grokBotPremium.windows[0].label, "공유 주간 한도");
assert.strictEqual(grokBotPremium.windows[1].label, "추가 사용 한도");
assert.strictEqual(grokBotPremium.creditBalances[0].label, "추가 사용");
assert.ok(!grokBotPremium.extras.some((item) => item.value === "미포함"));

const grokBotPlus = resultFromPayloads(
  { usagePercent: 0, hasAvailableUsage: false, cursorPlanName: "Plus" },
  null,
);
assert.strictEqual(grokBotPlus.plan, "Plus · $8 · Base");
assert.ok(grokBotPlus.extras.some((item) => item.label === "Grok Bot" && item.value === "미포함"));

console.log("x subscription plan tests passed");
