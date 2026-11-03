const { requestJson } = require("../http");

// Reporting is month-to-date in UTC. A key is never sent in a URL, logged,
// returned to the renderer, or used for a paid inference request.
function utcMonthRange(now = Date.now()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid reporting time");
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return {
    startSeconds: Math.floor(start / 1000),
    endSeconds: Math.floor(date.getTime() / 1000),
    startIso: new Date(start).toISOString(),
    endIso: date.toISOString(),
  };
}

// Reject accidentally pasted secret API keys, bearer tokens, or malformed
// identifiers before putting an identifier in a reporting URL query string.
function validTrackingId(providerId, value) {
  if (value == null || String(value).trim() === "") return true;
  const id = String(value).trim();
  if (id.length > 160) return false;
  if (providerId === "openai-api") return /^key_[A-Za-z0-9_-]+$/.test(id);
  if (providerId === "anthropic-api") return /^apikey_[A-Za-z0-9_-]+$/.test(id);
  return false;
}

function keyFilter(url, keyId) {
  if (typeof keyId === "string" && keyId.trim()) url.searchParams.append("api_key_ids[]", keyId.trim());
  return url;
}

// Both analytics APIs paginate. Never claim a partial page set is a monthly total.
async function collectAnalyticsPages(url, headers, request = requestJson, maxPages = 5) {
  const rows = [];
  let page = null;
  let refreshedAt = null;
  for (let index = 0; index < maxPages; index++) {
    const target = new URL(url);
    if (page) target.searchParams.set("page", page);
    const result = await request(target.toString(), { headers, timeoutMs: 15000 });
    if (!result || !result.ok) return { ok: false, status: result && result.status || 0, error: result && result.error || null };
    const payload = result.json;
    if (!payload || !Array.isArray(payload.data)) return { ok: false, status: 200, error: "사용량 응답 형식 오류" };
    rows.push(...payload.data);
    if (typeof payload.data_refreshed_at === "string") refreshedAt = payload.data_refreshed_at;
    if (payload.has_more !== true) return { ok: true, status: 200, data: rows, refreshedAt };
    if (typeof payload.next_page !== "string" || !payload.next_page) {
      return { ok: false, status: 200, error: "사용량 페이지 커서 누락" };
    }
    page = payload.next_page;
  }
  return { ok: false, status: 200, error: "사용량 페이지 한도 초과 (불완전한 합계는 표시하지 않음)" };
}

function numeric(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

// This is an informational spending budget supplied by the user. It is not
// a cash balance, prepaid balance, rate limit or payment method credit.
function monthlyBudgetBalance(monthlyBudgetUsd, spentUsd) {
  if (monthlyBudgetUsd == null || spentUsd == null) return null;
  const budget = Number(monthlyBudgetUsd);
  const spent = Number(spentUsd);
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent) || spent < 0) return null;
  const remaining = Math.max(0, Math.round((budget - spent) * 1e6) / 1e6);
  return {
    id: "user-monthly-budget",
    label: "월 예산 잔여(계산)",
    balance: remaining,
    used: spent,
    limit: budget,
    currency: "USD",
    remainingPct: Math.max(0, Math.min(100, remaining / budget * 100)),
    source: "user-defined-budget",
  };
}

function maskedTrackingId(keyId) {
  const value = String(keyId || "").trim();
  if (!value) return null;
  return value.length > 8 ? `…${value.slice(-6)}` : value;
}

function reportIssue(label, result) {
  if (result && (result.status === 401 || result.status === 403)) return `${label}: 관리자/분석 API 권한 필요`;
  return `${label}: ${result && result.error || (result && result.status ? `HTTP ${result.status}` : "조회 실패")}`;
}

function reportStatus(cost, usage) {
  if (cost.ok || usage.ok) return "ok";
  if ([cost.status, usage.status].some((status) => status === 401 || status === 403)) return "login";
  return "error";
}

module.exports = {
  utcMonthRange, validTrackingId, keyFilter, collectAnalyticsPages, numeric,
  monthlyBudgetBalance, maskedTrackingId, reportIssue, reportStatus,
};
