const { loadApiCreds, trimmedCreds, hasAllCreds, missingResult, loginResult, errorResult, okResult } = require("./common");
const { utcMonthRange, keyFilter, collectAnalyticsPages, numeric, reportIssue, reportStatus } = require("./analytics-common");

const ID = "anthropic-api";
const BASE = "https://api.anthropic.com/v1/organizations/analytics";

const definition = {
  id: ID,
  name: "Anthropic API (Claude)",
  brand: "#cc785c",
  vendor: "Anthropic",
  vendorOrder: 20,
  serviceOrder: 20,
  detail: "월간 비용·토큰 · 잔여 크레딧 공식 API 미지원",
  note: "Claude Console 조직 Admin API Key가 필요합니다(Enterprise는 분석 조회 권한 필요). API Key ID를 입력하면 특정 키의 사용량으로 제한합니다. Claude 구독 사용량과 별도이며, 선불 크레딧 잔액은 콘솔 결제 화면에서 확인해야 합니다.",
  credentials: [
    { key: "adminKey", label: "Admin / Analytics API Key", placeholder: "sk-ant-admin..." },
    { key: "apiKeyId", label: "조회 대상 API Key ID (선택)", placeholder: "미입력 시 조직 전체", required: false },
  ],
  missingHint: "설정 > AI API 키·크레딧에서 Anthropic 조직 Admin API Key를 등록하세요.",
};

function reportUrls(creds, now = Date.now()) {
  const range = utcMonthRange(now);
  const query = new URLSearchParams({ starting_at: range.startIso, ending_at: range.endIso });
  return {
    cost: keyFilter(new URL(`${BASE}/cost?${query}`), creds.apiKeyId).toString(),
    usage: keyFilter(new URL(`${BASE}/usage?${query}`), creds.apiKeyId).toString(),
  };
}

// Analytics cost.amount is a decimal string in cents, not dollars.
function parseCosts(rows) {
  if (!Array.isArray(rows)) return null;
  let cents = 0;
  for (const row of rows) {
    const amount = numeric(row && row.cost && row.cost.amount);
    if (amount == null || (row.cost.currency && row.cost.currency !== "USD")) return null;
    cents += amount;
  }
  return Math.round(cents * 1e4) / 1e6;
}

function parseUsage(rows) {
  if (!Array.isArray(rows)) return null;
  let tokens = 0;
  let requests = 0;
  for (const row of rows) {
    const total = numeric(row && row.usage && row.usage.total_tokens);
    const count = numeric(row && row.usage && row.usage.requests);
    if (total == null || count == null) return null;
    tokens += total;
    requests += count;
  }
  return { totalTokens: tokens, requests };
}

async function fetchUsage(_settings, _secrets, profile = null) {
  const creds = trimmedCreds(definition, loadApiCreds(ID, definition.credentials.map((field) => field.key), profile));
  if (!hasAllCreds(definition, creds)) return missingResult(definition, profile);

  const urls = reportUrls(creds);
  const headers = {
    "x-api-key": creds.adminKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "analytics-usage-cost-2026-08-24",
    Accept: "application/json",
  };
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
  const parsedUsage = usage.ok ? parseUsage(usage.data) : null;
  if (cost.ok && parsedCost == null) cost = { ok: false, status: 200, error: "비용 응답 형식 오류" };
  if (usage.ok && parsedUsage == null) usage = { ok: false, status: 200, error: "토큰 응답 형식 오류" };
  const status = reportStatus(cost, usage);
  if (status !== "ok") {
    const message = [reportIssue("비용", cost), reportIssue("토큰", usage)].join(" · ");
    return status === "login" ? loginResult(definition, message, profile) : errorResult(definition, message);
  }

  const creditBalances = [];
  if (cost.ok) creditBalances.push({ id: "month-cost", label: "이번 달 API 비용", used: parsedCost, currency: "USD", source: "anthropic-analytics-cost" });
  if (usage.ok) creditBalances.push({ id: "month-tokens", label: "이번 달 Claude 토큰", used: parsedUsage.totalTokens, unit: "토큰", source: "anthropic-analytics-usage" });
  const extras = [
    { label: "집계 범위", value: creds.apiKeyId ? "선택 API Key" : "조직 전체" },
    { label: "크레딧 잔액", value: "콘솔에서 확인" },
  ];
  if (usage.ok) extras.push({ label: "API 요청", value: `${parsedUsage.requests}건` });
  if ((cost.refreshedAt || usage.refreshedAt)) {
    const refreshedAt = cost.refreshedAt || usage.refreshedAt;
    extras.push({ label: "데이터 갱신", value: refreshedAt.slice(0, 16).replace("T", " ") + " UTC" });
  }
  if (!cost.ok) extras.push({ label: "비용", value: reportIssue("조회", cost) });
  if (!usage.ok) extras.push({ label: "토큰", value: reportIssue("조회", usage) });
  return okResult(definition, {
    creditBalances,
    extras,
    maxExtras: 6,
    cacheMaxAgeMs: 24 * 60 * 60 * 1000,
  });
}

module.exports = { ...definition, reportUrls, parseCosts, parseUsage, fetchUsage };
