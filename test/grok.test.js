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
assert.strictEqual(exhausted.billing.label, "이용 기간");
assert.strictEqual(exhausted.billing.renewsAt, Date.parse(reset));
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

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureGrokAuth, pickAuth, selectFreshAuth } = require("../lib/providers/grok");

const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
const authFile = path.join(authDir, "auth.json");
const expiredAt = "2026-09-23T00:00:00.000Z";
const now = Date.parse("2026-09-23T03:00:00.000Z");
fs.writeFileSync(authFile, JSON.stringify({
  "https://auth.x.ai": {
    key: "old-access",
    auth_mode: "oidc",
    user_id: "user-1",
    refresh_token: "old-refresh",
    expires_at: expiredAt,
    oidc_issuer: "https://auth.x.ai",
    oidc_client_id: "grok-cli",
  },
}, null, 2));

assert.strictEqual(selectFreshAuth(JSON.parse(fs.readFileSync(authFile, "utf8")), now), null, "expired Grok access token must not be used");
assert.strictEqual(pickAuth({ configDir: authDir }, now), null);

(async () => {
  const refreshed = await ensureGrokAuth(null, {
    authFile,
    now,
    requestJson: async (url, init) => {
      assert.strictEqual(url, "https://auth.x.ai/oauth2/token");
      assert.match(String(init.body), /grant_type=refresh_token/);
      assert.match(String(init.body), /refresh_token=old-refresh/);
      return {
        ok: true,
        status: 200,
        json: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 },
      };
    },
  });
  assert.strictEqual(refreshed.token, "new-access");
  const stored = JSON.parse(fs.readFileSync(authFile, "utf8"))["https://auth.x.ai"];
  assert.strictEqual(stored.key, "new-access");
  assert.strictEqual(stored.refresh_token, "new-refresh");
  assert.ok(Date.parse(stored.expires_at) > now);
  assert.strictEqual(pickAuth({ configDir: authDir }, now).token, "new-access");

  const failedFile = path.join(authDir, "failed-auth.json");
  fs.writeFileSync(failedFile, JSON.stringify({
    "https://auth.x.ai": {
      ...stored,
      key: "old-access",
      refresh_token: "old-refresh",
      expires_at: expiredAt,
    },
  }, null, 2));
  const failed = await ensureGrokAuth(null, {
    authFile: failedFile,
    now,
    requestJson: async () => ({ ok: false, status: 400, json: { error: "invalid_grant" } }),
  });
  assert.strictEqual(failed, null, "failed refresh must not invent an access token");
  assert.strictEqual(JSON.parse(fs.readFileSync(failedFile, "utf8"))["https://auth.x.ai"].refresh_token, "old-refresh");
  console.log("Grok shared-pool billing / credit tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
