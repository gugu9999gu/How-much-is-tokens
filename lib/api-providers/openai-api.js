const { loadApiCreds, trimmedCreds, hasAllCreds, missingResult, loginResult, errorResult, okResult } = require("./common");
const { utcMonthRange, keyFilter, collectAnalyticsPages, numeric, reportIssue, reportStatus } = require("./analytics-common");

const ID = "openai-api";
const BASE = "https://api.openai.com/v1/organization";

const definition = {
  id: ID,
  name: "OpenAI API (GPT)",
  brand: "#10a37f",
  vendor: "OpenAI",
  vendorOrder: 10,
  serviceOrder: 20,
  detail: "월간 비용·토큰 · 잔여 크레딧 공식 API 미지원",
  note: "일반 GPT API Key가 아닌 조직 Admin API Key가 필요합니다. API Key ID를 함께 입력하면 해당 키의 사용량으로 제한합니다. ChatGPT/Codex 구독은 별도입니다. 잔여 선불 크레딧은 공식 API로 조회할 수 없습니다.",
  credentials: [
    { key: "adminKey", label: "Admin API Key", placeholder: "sk-admin-..." },
    { key: "apiKeyId", label: "조회 대상 API Key ID (선택)", placeholder: "미입력 시 조직 전체", required: false },
  ],
  missingHint: "설정 > AI API 키·크레딧에서 OpenAI 조직 Admin API Key를 등록하세요.",
};

function reportUrls(creds, now = Date.now()) {
  const range = utcMonthRange(now);
  const query = `start_time=${range.startSeconds}&end_time=${range.endSeconds}&limit=31&bucket_width=1d`;
  return {
    cost: keyFilter(new URL(`${BASE}/costs?${query}`), creds.apiKeyId).toString(),
    usage: keyFilter(new URL(`${BASE}/usage/completions?${query}`), creds.apiKeyId).toString(),
  };
}

// Costs are in dollars, not cents, in the OpenAI administration API.
function parseCosts(rows) {
  if (!Array.isArray(rows)) return null;
  let total = 0;
  for (const bucket of rows) {
    if (!bucket || !Array.isArray(bucket.results)) return null;
    for (const result of bucket.results) {
      const amount = numeric(result && result.amount && result.amount.value);
      const currency = result && result.amount && result.amount.currency;
      if (amount == null || (currency && String(currency).toUpperCase() !== "USD")) return null;
      total += amount;
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

function parseCompletions(rows) {
  if (!Array.isArray(rows)) return null;
  let input = 0;
  let output = 0;
  let requests = 0;
  for (const bucket of rows) {
    if (!bucket || !Array.isArray(bucket.results)) return null;
    for (const result of bucket.results) {
      const inTokens = numeric(result && result.input_tokens);
      const outTokens = numeric(result && result.output_tokens);
      const req = numeric(result && result.num_model_requests);
      if (inTokens == null || outTokens == null || req == null) return null;
      input += inTokens;
      output += outTokens;
      requests += req;
    }
  }
  return { totalTokens: input + output, inputTokens: input, outputTokens: output, requests };
}

async function fetchUsage(_settings, _secrets, profile = null) {
  const creds = trimmedCreds(definition, loadApiCreds(ID, definition.credentials.map((field) => field.key), profile));
  if (!hasAllCreds(definition, creds)) return missingResult(definition, profile);

  const urls = reportUrls(creds);
  const headers = { Authorization: `Bearer ${creds.adminKey}`, Accept: "application/json" };
  let cost;
  let usage;
  try {
    [cost, usage] = await Promise.all([
      collectAnalyticsPages(urls.cost, headers),
      collectAnalyticsPages(urls.usage, headers),
    ]);
  } catch (error) {
    return errorResult(definition, error.message || String(error));
  }

  const parsedCost = cost.ok ? parseCosts(cost.data) : null;
  const parsedUsage = usage.ok ? parseCompletions(usage.data) : null;
  if (cost.ok && parsedCost == null) cost = { ok: false, status: 200, error: "비용 응답 형식 오류" };
  if (usage.ok && parsedUsage == null) usage = { ok: false, status: 200, error: "토큰 응답 형식 오류" };
  const status = reportStatus(cost, usage);
  if (status !== "ok") {
    const message = [reportIssue("비용", cost), reportIssue("토큰", usage)].join(" · ");
    return status === "login" ? loginResult(definition, message, profile) : errorResult(definition, message);
  }

  const creditBalances = [];
  if (cost.ok) creditBalances.push({ id: "month-cost", label: "이번 달 API 비용", used: parsedCost, currency: "USD", source: "openai-organization-costs" });
  if (usage.ok) creditBalances.push({ id: "month-tokens", label: "이번 달 GPT 토큰", used: parsedUsage.totalTokens, unit: "토큰", source: "openai-organization-completions" });
  const extras = [
    { label: "집계 범위", value: creds.apiKeyId ? "선택 API Key" : "조직 전체" },
    { label: "크레딧 잔액", value: "공식 조회 미지원" },
  ];
  if (usage.ok) extras.push({ label: "API 요청", value: `${parsedUsage.requests}건` });
  if (!cost.ok) extras.push({ label: "비용", value: reportIssue("조회", cost) });
  if (!usage.ok) extras.push({ label: "토큰", value: reportIssue("조회", usage) });
  return okResult(definition, {
    creditBalances,
    extras,
    maxExtras: 5,
    cacheMaxAgeMs: 6 * 60 * 60 * 1000,
  });
}

module.exports = { ...definition, reportUrls, parseCosts, parseCompletions, fetchUsage };
