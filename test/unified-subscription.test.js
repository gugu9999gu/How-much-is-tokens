const assert = require("assert");
const { parseBillingPayload } = require("../lib/providers/grok");
const { resultFromPayloads } = require("../lib/providers/grokbot");
const { combineUnifiedSubscription } = require("../lib/unified-subscription");

const reset = "2026-11-02T00:45:20.858Z";

const grok = {
  id: "grok",
  status: "ok",
  ...parseBillingPayload({
    config: {
      isUnifiedBillingUser: true,
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: reset },
      creditUsagePercent: 13,
      prepaidBalance: { val: 0 },
      productUsage: [
        { product: "Cursor", usagePercent: 11 },
        { product: "GrokBot", usagePercent: 2 },
      ],
    },
  }),
};

const grokbot = {
  id: "grokbot",
  status: "ok",
  ...resultFromPayloads({
    isUnified: true,
    usagePercent: 13.954496208017336,
    hasAvailableUsage: true,
    nextResetTimestampUtc: reset,
    cursorPlanName: "Premium",
    grokPlanLabel: "Grok Bot Plan",
  }, null),
};

const cursor = {
  id: "cursor",
  status: "ok",
  membership: "premium",
  plan: "Premium · $30 · 4x",
  remainingPct: 100,
  windows: [{ id: "included", label: "포함 사용량", remainingPct: 100, usedPct: 0 }],
  creditBalances: [{ id: "included", label: "포함 크레딧", balance: 46.15, currency: "USD" }],
};

const codex = { id: "codex", status: "ok", name: "Codex", remainingPct: 40 };

assert.strictEqual(grok.unified, true);
assert.strictEqual(grokbot.unified, true);
assert.strictEqual(grok.windows[0].label, "공유 주간 한도");

const unified = combineUnifiedSubscription([codex, cursor, grok, grokbot]);
assert.deepStrictEqual(unified.map((item) => item.id), ["codex", "x-subscription"]);
const card = unified[1];
assert.strictEqual(card.name, "X Subscription");
assert.strictEqual(card.plan, "Premium · $30 · 4x");
assert.strictEqual(card.windows.length, 1);
assert.strictEqual(card.windows[0].label, "공유 주간 한도");
assert.strictEqual(card.windows[0].usedPct, 13);
assert.strictEqual(card.windows[0].remainingPct, 87);
assert.deepStrictEqual(card.extras.map((item) => item.label), ["Cursor", "GrokBot", "포함"]);
assert.strictEqual(card.extras[2].value, "Cursor · Grok · Grok Bot");
assert.ok(!card.creditBalances.some((item) => item.id === "included"), "the separate Cursor allowance must not be added to the shared plan");
assert.strictEqual(card.creditBalances[0].id, "prepaid");
assert.strictEqual(card.creditBalances[0].balance, 0);

const legacy = combineUnifiedSubscription([
  { id: "cursor", status: "ok", membership: "pro", plan: "Pro · $20", windows: [{ id: "auto", remainingPct: 50 }] },
  { id: "grok", status: "ok", unified: false, plan: "SuperGrok", windows: [{ id: "weekly", remainingPct: 10 }] },
  { id: "grokbot", status: "ok", unified: false, plan: "Pro · $20", windows: [{ id: "weekly", remainingPct: 20 }] },
]);
assert.deepStrictEqual(legacy.map((item) => item.id), ["cursor", "grok", "grokbot"]);

console.log("unified subscription display tests passed");
