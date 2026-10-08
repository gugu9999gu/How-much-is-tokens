const { getCursorAuth, replacementCursorAuth } = require("./cursor-auth");
const { requestJson, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { amountFromMinor, finiteNumber, remainingPercent } = require("../credit-balances");
const { billingCycle } = require("../billing-cycle");

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

function includedAllowanceWindow(plan, resetAt) {
  if (!plan || typeof plan !== "object") return null;
  const limit = finiteNumber(plan.limit);
  if (limit == null || limit <= 0) return null;
  const used = finiteNumber(plan.used);
  const remaining = finiteNumber(plan.remaining);
  const remainingValue = remaining != null
    ? Math.max(0, remaining)
    : (used != null ? Math.max(0, limit - used) : null);
  if (remainingValue == null) return null;
  const remainingPct = Math.max(0, Math.min(100, (remainingValue / limit) * 100));
  return {
    id: "included",
    label: "포함 사용량",
    usedPct: Math.max(0, Math.min(100, 100 - remainingPct)),
    remainingPct,
    resetAt,
  };
}

function cursorQuotaWindows(data, resetAt) {
  const plan = data && data.individualUsage && data.individualUsage.plan;
  const included = includedAllowanceWindow(plan, resetAt);
  const pools = [
    planWindow(plan, "autoPercentUsed", "auto", "Cursor Models", resetAt),
    planWindow(plan, "apiPercentUsed", "api", "Other Models", resetAt),
  ].filter(Boolean);
  if (included) return [included, ...pools];
  return [
    planWindow(plan, "totalPercentUsed", "total", "전체", resetAt),
    ...pools,
  ].filter(Boolean);
}

function cursorBonusCents(data) {
  const plan = data && data.individualUsage && data.individualUsage.plan;
  const bonus = plan && plan.breakdown ? finiteNumber(plan.breakdown.bonus) : null;
  return bonus != null && bonus > 0 ? bonus : null;
}

function billingFromCursorUsage(data) {
  if (!data || typeof data !== "object") return null;
  return billingCycle({
    renewsAt: data.billingCycleEnd,
    startedAt: data.billingCycleStart,
    label: "결제일",
    source: "cursor-billing-cycle",
  });
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

function summaryRequest(auth) {
  return requestJson("https://cursor.com/api/usage-summary", {
    headers: {
      Cookie: auth.cookie,
      Accept: "application/json",
      "User-Agent": "cursor-agent/2026.09.04",
    },
  });
}

async function fetchUsage(settings = {}, _secrets = {}, profile = null) {
  let auth = getCursorAuth(settings || {}, profile);
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
  let res = await summaryRequest(auth);
  if ((res.status === 401 || res.status === 403) && !profile && String((settings || {}).cursorCookie || "").trim()) {
    const replacement = replacementCursorAuth(auth, getCursorAuth({}, null), {
      configuredCookie: true,
    });
    if (replacement) {
      const retry = await summaryRequest(replacement);
      if (retry.ok && retry.json) {
        auth = replacement;
        res = retry;
      }
    }
  }

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
  const billing = billingFromCursorUsage(data);
  const windows = cursorQuotaWindows(data, resetAt);
  const included = windows.find((win) => win.id === "included") || null;
  const limitReached = !!(included && included.remainingPct <= 0);

  const primary = windows[0] || null;
  const extras = [];
  const bonus = cursorBonusCents(data);
  if (bonus != null) {
    const amount = amountFromMinor(bonus, 2);
    if (amount != null) extras.push({ label: "보너스 사용", value: `$${amount.toFixed(2)}` });
  }
  if (limitReached) extras.push({ label: "상태", value: "한도 도달" });

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
    limitReached,
    windows,
    creditBalances: cursorCreditBalances(data, resetAt),
    billing,
    extras,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  planWindow,
  moneyBalance,
  billingFromCursorUsage,
  cursorCreditBalances,
  includedAllowanceWindow,
  cursorQuotaWindows,
  cursorBonusCents,
};
