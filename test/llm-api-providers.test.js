const assert = require("assert");
const fs = require("fs");
const path = require("path");
const openai = require("../lib/api-providers/openai-api");
const anthropic = require("../lib/api-providers/anthropic-api");
const { utcMonthRange, collectAnalyticsPages, reportStatus, monthlyBudgetBalance, maskedTrackingId, validTrackingId } = require("../lib/api-providers/analytics-common");
const { hasAllCreds } = require("../lib/api-providers/common");
const { apiProviderById, apiProviderCatalog } = require("../lib/api-providers/registry");
const { MEDIA_PROVIDER_IDS, normalizeMediaProviderProfiles, normalizeMonthlyBudgetUsd } = require("../lib/media-provider-profiles");
const { safeCreditBalance } = require("../lib/credit-balances");

const range = utcMonthRange(Date.parse("2026-10-30T01:23:45Z"));
assert.strictEqual(range.startIso, "2026-10-01T00:00:00.000Z");
assert.strictEqual(range.endSeconds, Math.floor(Date.parse("2026-10-30T01:23:45Z") / 1000));

const target = { adminKey: "sk-admin-fixture", apiKeyId: "key_123" };
const openaiUrls = openai.reportUrls(target, Date.parse("2026-10-30T01:00:00Z"));
const openaiCost = new URL(openaiUrls.cost);
assert.strictEqual(openaiCost.hostname, "api.openai.com");
assert.strictEqual(openaiCost.pathname, "/v1/organization/costs");
assert.strictEqual(openaiCost.searchParams.get("api_key_ids"), "key_123");
assert.ok(!openaiUrls.cost.includes(target.adminKey), "Never place secret in URL");
assert.strictEqual(new URL(openaiUrls.usage).pathname, "/v1/organization/usage/completions");
assert.strictEqual(new URL(openai.reportUrls({ adminKey: "fixture" }).cost).searchParams.has("api_key_ids"), false);

const claudeUrls = anthropic.reportUrls({ adminKey: "fixture", apiKeyId: "apikey_123" }, Date.parse("2026-10-30T01:00:00Z"));
assert.strictEqual(new URL(claudeUrls.cost).pathname, "/v1/organizations/analytics/cost");
assert.strictEqual(new URL(claudeUrls.usage).searchParams.get("api_key_ids[]"), "apikey_123");
assert.strictEqual(new URL(claudeUrls.cost).searchParams.get("starting_at"), "2026-10-01T00:00:00.000Z");

assert.strictEqual(openai.parseCosts([{ results: [{ amount: { value: 1.25 } }, { amount: { value: 0.75 } }] }]), 2);
assert.strictEqual(openai.parseCosts([{ results: [] }]), 0);
assert.strictEqual(openai.parseCosts([{ results: [{ amount: null }] }]), null);
assert.deepStrictEqual(openai.parseCompletions([{ results: [
  { input_tokens: 1500, output_tokens: 500, num_model_requests: 3 },
  { input_tokens: 100, output_tokens: 100, num_model_requests: 1 },
] }]), { totalTokens: 2200, inputTokens: 1600, outputTokens: 600, requests: 4 });
assert.strictEqual(openai.parseCompletions([{ results: [{ input_tokens: 10 }] }]), null);

assert.strictEqual(anthropic.parseCosts([{ cost: { amount: "41280.000000", currency: "USD" } }]), 412.8);
assert.strictEqual(anthropic.parseCosts([{ cost: { amount: "99.550000", currency: "USD" } }]), 0.9955);
assert.strictEqual(anthropic.parseCosts([]), 0);
assert.strictEqual(anthropic.parseCosts([{ cost: { amount: "x", currency: "USD" } }]), null);
assert.deepStrictEqual(anthropic.parseUsage([
  { usage: { total_tokens: 5590800, requests: 4210 } },
  { usage: { total_tokens: 1200, requests: 10 } },
]), { totalTokens: 5592000, requests: 4220 });
assert.strictEqual(anthropic.parseUsage([{ usage: {} }]), null);

// The API Key ID (Tracking ID) selects one key; an Admin key provides authorization.
assert.strictEqual(maskedTrackingId("key_0123456789abc"), "…789abc");
assert.strictEqual(validTrackingId("openai-api", "key_123"), true);
assert.strictEqual(validTrackingId("anthropic-api", "apikey_123"), true);
assert.strictEqual(validTrackingId("openai-api", "sk-raw-secret"), false, "secret keys are not Tracking IDs");
assert.strictEqual(validTrackingId("anthropic-api", "sk-ant-raw-secret"), false);
assert.strictEqual(validTrackingId("openai-api", "apikey_123"), false);
assert.throws(() => openai.reportUrls({ apiKeyId: "sk-should-not-go-in-url" }), /Tracking ID/);
assert.throws(() => anthropic.reportUrls({ apiKeyId: "sk-ant-secret" }), /Tracking ID/);
assert.strictEqual(maskedTrackingId(""), null);
assert.ok(openai.credentials.some((field) => field.key === "apiKeyId" && field.label.includes("Tracking ID")));
assert.ok(anthropic.credentials.some((field) => field.key === "apiKeyId" && field.label.includes("Tracking ID")));

// A user-set budget is never the real balance of prepaid provider credits.
assert.strictEqual(normalizeMonthlyBudgetUsd("50.25"), 50.25);
for (const value of [0, -1, "not a number", "1.234", "1000000.01", Infinity]) {
  assert.strictEqual(normalizeMonthlyBudgetUsd(value), null, `invalid budget: ${value}`);
}
const underBudget = monthlyBudgetBalance(50, 12.34);
assert.strictEqual(underBudget.balance, 37.66);
assert.strictEqual(underBudget.used, 12.34);
assert.strictEqual(underBudget.limit, 50);
assert.strictEqual(underBudget.source, "user-defined-budget");
assert.ok(underBudget.remainingPct > 75 && underBudget.remainingPct < 76);
assert.strictEqual(monthlyBudgetBalance(10, 15).balance, 0, "overspend must not produce negative budget remaining");
assert.strictEqual(monthlyBudgetBalance(50, null), null, "cost query failure must not invent budget remaining");

const onlyAdmin = { adminKey: "sk-admin-fixture", apiKeyId: "" };
assert.ok(hasAllCreds(openai, onlyAdmin), "API key ID must remain optional");
assert.ok(hasAllCreds(anthropic, onlyAdmin), "Anthropic key ID must remain optional");
assert.ok(!hasAllCreds(openai, { adminKey: "", apiKeyId: "key_123" }));
assert.ok(MEDIA_PROVIDER_IDS.includes("openai-api"));
assert.ok(MEDIA_PROVIDER_IDS.includes("anthropic-api"));
assert.strictEqual(normalizeMediaProviderProfiles([
  { providerId: "openai-api", id: "my-gpt", label: "GPT 업무", enabled: true },
  { providerId: "anthropic-api", id: "my-claude", label: "Claude 업무", enabled: true },
]).length, 2);
const withBudget = normalizeMediaProviderProfiles([
  { providerId: "openai-api", id: "key-work", label: "GPT 업무", monthlyBudgetUsd: 125.50 },
  { providerId: "anthropic-api", id: "key-personal", label: "Claude 개인", monthlyBudgetUsd: "3.45" },
  { providerId: "stability", id: "no-budget", monthlyBudgetUsd: 100 },
]);
assert.strictEqual(withBudget[0].monthlyBudgetUsd, 125.50);
assert.strictEqual(withBudget[1].monthlyBudgetUsd, 3.45);
assert.ok(!Object.prototype.hasOwnProperty.call(withBudget[2], "monthlyBudgetUsd"));
for (const provider of [openai, anthropic]) {
  assert.strictEqual(apiProviderById(provider.id), provider);
  const catalog = apiProviderCatalog().find((item) => item.id === provider.id);
  assert.ok(catalog.note.includes("Admin"));
  assert.strictEqual(catalog.credentials[1].required, false);
  const sample = safeCreditBalance({ id: "month-cost", label: "이번 달 비용", used: 12.34, currency: "USD" });
  assert.strictEqual(sample.balance, null, "Spent money must not be represented as remaining credit");
  assert.strictEqual(sample.used, 12.34);
}
assert.strictEqual(reportStatus({ ok: false, status: 403 }, { ok: false, status: 403 }), "login");
assert.strictEqual(reportStatus({ ok: true, status: 200 }, { ok: false, status: 429 }), "ok");
assert.strictEqual(reportStatus({ ok: false, status: 429 }, { ok: false, status: 500 }), "error");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
assert.ok(rendererSource.includes('if (value == null || value === "") return null;'), "null remaining must not render as $0");
assert.ok(rendererSource.includes('balance.balance == null && balance.used != null'), "spend-only credits must be visible even in compact mode");
const settingsUi = fs.readFileSync(path.join(__dirname, "..", "renderer", "api-providers-settings.js"), "utf8");
assert.ok(settingsUi.includes("Tracking ID"), "tracking scope label must be accessible");
assert.ok(settingsUi.includes("data-api-budget"), "budget value must be editable");
assert.ok(settingsUi.includes('input.type = cred.key === "apiKeyId" ? "text" : "password"'), "Tracking ID is not a secret API key");

(async () => {
  const requests = [];
  const fakeRequest = async (url, { headers }) => {
    requests.push(url);
    assert.strictEqual(headers.Authorization, "Bearer fixture-secret");
    const next = new URL(url).searchParams.get("page");
    return { ok: true, status: 200, json: next
      ? { data: [{ results: [{ amount: { value: 2 } }] }], has_more: false, data_refreshed_at: "2026-10-30T01:00:00Z" }
      : { data: [{ results: [{ amount: { value: 1 } }] }], has_more: true, next_page: "page_2" },
    };
  };
  const pages = await collectAnalyticsPages("https://api.openai.com/v1/organization/costs?start_time=1", { Authorization: "Bearer fixture-secret" }, fakeRequest);
  assert.ok(pages.ok);
  assert.strictEqual(pages.data.length, 2);
  assert.strictEqual(requests.length, 2);
  assert.ok(requests[1].includes("page=page_2"));
  assert.strictEqual(pages.refreshedAt, "2026-10-30T01:00:00Z");

  const forbidden = await collectAnalyticsPages("https://api.openai.com", {}, async () => ({ ok: false, status: 403 }));
  assert.deepStrictEqual(forbidden, { ok: false, status: 403, error: null });
  const malformed = await collectAnalyticsPages("https://api.openai.com", {}, async () => ({ ok: true, status: 200, json: {} }));
  assert.strictEqual(malformed.ok, false);
  const stuck = await collectAnalyticsPages("https://api.openai.com", {}, async () => ({ ok: true, status: 200, json: { data: [], has_more: true, next_page: "next" } }), 2);
  assert.strictEqual(stuck.ok, false, "partial pagination must not yield a false total");

  // No credentials in the test environment, and therefore no external billing calls.
  for (const provider of [openai, anthropic]) {
    const missing = await provider.fetchUsage({}, {});
    assert.strictEqual(missing.status, "missing");
    assert.ok(missing.hint);
  }
  console.log("OpenAI/Anthropic API analytics provider tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
