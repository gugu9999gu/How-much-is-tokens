const assert = require("assert");
const { billingCycle } = require("../lib/billing-cycle");
const {
  couponsFromCedar,
  couponsFromJuniper,
  combineResetCoupons,
  billingFromClaudeProfile,
  readClaudeAccountFacts,
  clearClaudeFactCache,
} = require("../lib/claude-reset-credits");
const {
  whamResetSummary,
  normalizeWhamResetCreditList,
  mergeCodexResetTickets,
  publicResetCoupons,
} = require("../lib/providers/codex");
const { billingFromCursorUsage } = require("../lib/providers/cursor");
const { billingFromCopilot } = require("../lib/providers/copilot");

const now = Date.parse("2026-09-23T00:00:00Z");

assert.strictEqual(billingCycle({}), null, "missing billing fields must not invent a cycle");
const cursor = billingFromCursorUsage({
  billingCycleStart: "2026-08-24T01:55:52.000Z",
  billingCycleEnd: "2026-09-24T01:55:52.000Z",
});
assert.strictEqual(cursor.label, "결제일");
assert.strictEqual(cursor.renewsAt, Date.parse("2026-09-24T01:55:52.000Z"));
assert.strictEqual(cursor.startedAt, Date.parse("2026-08-24T01:55:52.000Z"));

const copilot = billingFromCopilot({ quota_reset_date_utc: "2026-10-01T00:00:00.000Z" });
assert.strictEqual(copilot.label, "할당 갱신");
assert.strictEqual(copilot.renewsAt, Date.parse("2026-10-01T00:00:00.000Z"));

const claudeBilling = billingFromClaudeProfile({
  organization: {
    subscription_status: "active",
    subscription_created_at: "2025-07-22T00:43:28.093226Z",
  },
});
assert.strictEqual(claudeBilling.renewsAt, null, "Claude profile has no next charge date");
assert.strictEqual(claudeBilling.startedAt, Date.parse("2025-07-22T00:43:28.093226Z"));
assert.strictEqual(billingFromClaudeProfile({
  account: { has_claude_pro: true, has_claude_max: false },
  organization: { subscription_status: "active", subscription_created_at: "2025-07-22T00:43:28.093226Z" },
}).planLabel, "Pro");
assert.strictEqual(billingFromClaudeProfile({ organization: { subscription_status: "active" } }).note, "다음 결제일 미제공");

const cedar = couponsFromCedar({
  eligible: true,
  grants: [
    { id: "keep", label: "Opus reset", resets_left: 1, ends_at: "2026-10-22T00:00:00Z" },
    { id: "spent", resets_left: 0, ends_at: "2026-10-22T00:00:00Z" },
    { id: "old", resets_left: 2, ends_at: "2026-09-01T00:00:00Z" },
  ],
}, now);
assert.strictEqual(cedar.availableCount, 1);
assert.strictEqual(cedar.tickets[0].title, "Opus reset");
assert.strictEqual(cedar.tickets[0].id, undefined, "coupon ids must not be copied into the widget payload");

const webOnly = couponsFromCedar({
  eligible: false,
  ineligible_reason: "surface",
  grants: [],
}, now);
assert.strictEqual(webOnly.visibility, "web-only");
assert.strictEqual(webOnly.availableCount, null);

const juniper = couponsFromJuniper({
  eligible: true,
  arm: "reset",
  available: true,
  weekly_resets_at: "2026-09-30T00:00:00Z",
}, now);
assert.strictEqual(juniper.availableCount, 1);
assert.strictEqual(combineResetCoupons([webOnly, { visibility: "known", availableCount: 0, tickets: [] }]).visibility, "web-only");
assert.strictEqual(combineResetCoupons([cedar, juniper]).availableCount, 2);
assert.strictEqual(combineResetCoupons([null, null]).visibility, "unknown");

const summary = whamResetSummary({
  rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
});
const details = normalizeWhamResetCreditList({
  available_count: 1,
  credits: [{
    id: "credit-secret",
    status: "available",
    title: "Full reset",
    granted_at: "2026-09-22T20:44:46.772929Z",
    expires_at: "2026-10-22T20:44:46.772929Z",
  }],
}, now);
const merged = mergeCodexResetTickets({
  summary,
  details,
  appServer: { availableCount: 9, tickets: [{ title: "stale", expiresAt: now + 1000 }] },
});
assert.strictEqual(merged.availableCount, 1, "wham usage count wins over app-server");
assert.strictEqual(merged.applicableCount, 0);
assert.strictEqual(merged.tickets[0].title, "Full reset");
assert.strictEqual(merged.tickets[0].id, undefined);
const shown = publicResetCoupons(merged);
assert.strictEqual(shown.availableCount, 1);
assert.strictEqual(shown.tickets[0].title, "Full reset");
assert.strictEqual(shown.tickets[0].id, undefined);
assert.strictEqual(mergeCodexResetTickets({ appServer: { availableCount: 2, tickets: [] } }).availableCount, 2);

clearClaudeFactCache();
(async () => {
  const facts = await readClaudeAccountFacts("token", { five_hour: { utilization: 1 } }, {
    cacheKey: "account-facts-test",
    now,
    requestJson: async (url) => {
      if (String(url).includes("cedar_ember=1")) {
        return {
          ok: true,
          json: { cedar_ember: { eligible: false, ineligible_reason: "surface", grants: [] } },
        };
      }
      if (String(url).includes("at_wall=1")) {
        return { ok: true, json: { juniper_tide: null, cedar_ember: null } };
      }
      if (String(url).endsWith("/profile")) {
        return {
          ok: true,
          json: { organization: { subscription_created_at: "2025-07-22T00:43:28.093226Z", subscription_status: "active" } },
        };
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.strictEqual(facts.resetCoupons.visibility, "web-only");
  assert.strictEqual(facts.resetCoupons.availableCount, null);
  assert.strictEqual(facts.billing.startedAt, Date.parse("2025-07-22T00:43:28.093226Z"));
  assert.strictEqual(facts.billing.renewsAt, null);
  console.log("account fact / reset coupon / billing cycle tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
