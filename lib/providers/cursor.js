const { getCursorAuth } = require("./cursor-auth");
const { requestJson, pick, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

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

async function fetchUsage(settings) {
  const auth = getCursorAuth(settings || {});
  if (!auth || !auth.cookie) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Cursor에 로그인하거나 설정에 WorkosCursorSessionToken 을 붙여넣으세요.",
    };
  }

  const res = await requestJson("https://cursor.com/api/usage-summary", {
    headers: {
      Cookie: auth.cookie,
      Accept: "application/json",
      "User-Agent": "cursor-agent/2026.07.07",
    },
  });

  if (res.status === 401 || res.status === 403) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Cursor 세션이 만료되었습니다. Cursor를 연 뒤 다시 시도하세요.",
    };
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
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
  if (plan && plan.remaining != null && plan.limit != null) {
    extras.push({ label: "플랜 잔여", value: `${plan.remaining} / ${plan.limit}` });
  }
  const onDemand = data.individualUsage && data.individualUsage.onDemand;
  if (onDemand && onDemand.used != null) extras.push({ label: "On-demand", value: String(onDemand.used) });
  const message = pick(data, "autoModelSelectedDisplayMessage", "namedModelSelectedDisplayMessage");
  if (message) extras.push({ label: "안내", value: message });

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.membershipType || auth.membership,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt,
    windows,
    extras,
  };
}

module.exports = { id: ID, fetchUsage, planWindow };
