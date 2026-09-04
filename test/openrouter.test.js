const assert = require("assert");
const {
  parseKeyPayload,
  parseCreditsPayload,
  openRouterCreditBalances,
  limitLabel,
  money,
} = require("../lib/providers/openrouter");

const key = parseKeyPayload({
  data: {
    label: "sk-or-v1-test...123",
    limit: 100,
    limit_remaining: 74.5,
    limit_reset: "monthly",
    usage: 25.5,
    usage_daily: 1.25,
    usage_weekly: 8.5,
    usage_monthly: 25.5,
    is_free_tier: false,
  },
});

assert.ok(key.window);
assert.strictEqual(key.window.id, "api-key-limit");
assert.strictEqual(key.window.label, "API Key 월간 한도");
assert.strictEqual(key.window.remainingPct, 74.5);
assert.strictEqual(key.window.usedPct, 25.5);
assert.strictEqual(key.usageDaily, 1.25);
assert.strictEqual(key.usageWeekly, 8.5);
assert.strictEqual(key.usageMonthly, 25.5);

const credits = parseCreditsPayload({
  data: {
    total_credits: 100.5,
    total_usage: 25.75,
  },
});
assert.ok(credits);
assert.strictEqual(credits.totalCredits, 100.5);
assert.strictEqual(credits.totalUsage, 25.75);
assert.strictEqual(credits.remaining, 74.75);
assert.ok(Math.abs(credits.window.remainingPct - (74.75 / 100.5 * 100)) < 0.0001);
assert.strictEqual(credits.window.label, "계정 크레딧");

const balances = openRouterCreditBalances(key, credits);
assert.deepStrictEqual(balances.map((item) => item.id), ["account-credits", "api-key-limit"]);
assert.strictEqual(balances[0].balance, 74.75);
assert.strictEqual(balances[0].used, 25.75);
assert.strictEqual(balances[0].limit, 100.5);
assert.strictEqual(balances[0].currency, "USD");
assert.ok(Math.abs(balances[0].remainingPct - (74.75 / 100.5 * 100)) < 0.0001);
assert.strictEqual(balances[1].balance, 74.5);
assert.strictEqual(balances[1].used, 25.5);
assert.strictEqual(balances[1].limit, 100);
assert.strictEqual(balances[1].remainingPct, 74.5);

const computedLimit = parseKeyPayload({ data: { limit: 50, usage: 20, limit_reset: "weekly" } });
assert.strictEqual(computedLimit.limitRemaining, 30);
assert.strictEqual(computedLimit.window.remainingPct, 60);
assert.strictEqual(computedLimit.window.label, "API Key 주간 한도");

const unlimited = parseKeyPayload({ data: { usage: 12.34, usage_monthly: 4.56 } });
assert.strictEqual(unlimited.window, null, "no spending cap must not fabricate a quota gauge");
assert.deepStrictEqual(openRouterCreditBalances(unlimited, null), [], "unlimited/no-cap key must not fabricate a monetary balance");

const zeroCredits = parseCreditsPayload({ data: { total_credits: 0, total_usage: 0 } });
assert.strictEqual(zeroCredits.remaining, 0);
assert.strictEqual(zeroCredits.window.remainingPct, 0);

assert.strictEqual(limitLabel("daily"), "API Key 일일 한도");
assert.strictEqual(limitLabel("unknown"), "API Key 한도");
assert.strictEqual(money(3.5), "$3.50");

console.log("OpenRouter provider / common credit tests passed");
