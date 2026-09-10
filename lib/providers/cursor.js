const { getCursorAuth } = require("./cursor-auth");
const { requestJson, pick, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { amountFromMinor, remainingPercent } = require("../credit-balances");

const ID = "cursor";
const NAME = "Cursor";
const BRAND = "#9b8aff";

function planWindow(plan, key, id, label, resetAt) {
  if (!plan) return null;
  const usedPct = num(plan[key]);
  if (usedPct == null) return null;
  return {
    id,
    label,
    usedPct,
    remainingPct: remainingFromUsed(usedPct),
    resetAt,
  };
}

function moneyBalance(raw, id, label, resetAt) {
  if (!raw || typeof raw !== "object" || raw.enabled === false) return null;
  const used = amountFromMinor(raw.used, 2);
  const limit = amountFromMinor(raw.limit, 2);
  let balance = amountFromMinor(raw.remaining, 2);
  if (balance == null && limit != null && used != null) balance = Math.max(0, limit - used);
  if (used == null && limit == null && balance == null) return null;
  return {
    id,
    label,
    balance: balance == null ? null : Math.max(0, balance),
    used: used == null ? null : Math.max(0, used),
    limit: limit == null ? null : Math.max(0, limit),
    currency: "USD",
    remainingPct: remainingPercent(balance, limit),
    resetAt,
    source: "cursor-usage-summary",
  };
}

function cursorCreditBalances(data, resetAt) {
  const balances = [];
  const individual = data && data.individualUsage || {};
  const plan = moneyBalance(individual.plan, "included", "포함 크레딧", resetAt);
  const onDemand = moneyBalance(individual.onDemand, "on-demand", "On-demand", resetAt);
  if (plan) balances.push(plan);
  if (onDemand) balances.push(onDemand);

  const team = data && data.teamUsage || {};
  const teamPooled = moneyBalance(team.pooled, "team-pooled", "팀 공유 크레딧", resetAt);
  const teamOnDemand = moneyBalance(team.onDemand, "team-on-demand", "팀 On-demand", resetAt);
  if (teamPooled) balances.push(teamPooled);
  if (teamOnDemand) balances.push(teamOnDemand);
  return balances;
}

async function fetchUsage(settings = {}, _secrets = {}, profile = null) {
  const auth = getCursorAuth(settings || {}, profile);
  if (!auth || !auth.cookie) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: profile
        ? "이 Cursor CLI 프로필에 로그인 정보가 없습니다. 해당 CURSOR_CONFIG_DIR에서 agent login을 실행하세요."
        : "Cursor에 로그인하거나 설정에 WorkosCursorSessionToken 을 붙여넣으세요.",
    };
  }

  const accountKey = stableAccountKey(ID, auth.userId);
  const res = await requestJson("https://cursor.com/api/usage-summary", {
    headers: {
      Cookie: auth.cookie,
      Accept: "application/json",
      "User-Agent": "cursor-agent/2026.09.04",
    },
  });

  if (res.status === 401 || res.status === 403) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: profile
        ? "이 Cursor CLI 프로필 세션이 만료되었습니다. 해당 프로필에서 다시 로그인하세요."
        : "Cursor 세션이 만료되었습니다. Cursor를 연 뒤 다시 시도하세요.",
    };
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: res.error || `HTTP ${res.status}`,
    };
  }

  const data = res.json;
  const resetAt = parseTime(data.billingCycleEnd);
  const plan = data.individualUsage && data.individualUsage.plan;
  const windows = [
    planWindow(plan, "totalPercentUsed", "total", "전체", resetAt),
    planWindow(plan, "autoPercentUsed", "auto", "Cursor Models", resetAt),
    planWindow(plan, "apiPercentUsed", "api", "Other Models", resetAt),
  ].filter(Boolean);

  const primary = windows[0] || null;
  const extras = [];
  const message = pick(data, "autoModelSelectedDisplayMessage", "namedModelSelectedDisplayMessage");
  if (message) extras.push({ label: "안내", value: message });

  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.membershipType || auth.membership,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt,
    windows,
    creditBalances: cursorCreditBalances(data, resetAt),
    extras,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  planWindow,
  moneyBalance,
  cursorCreditBalances,
};
