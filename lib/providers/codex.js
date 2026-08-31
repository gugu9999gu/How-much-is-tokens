const path = require("path");
const { home, readJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

const ID = "codex";
const NAME = "Codex";
const BRAND = "#10a37f";

function classifyWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seconds = Number(raw.limit_window_seconds || 0);
  const usedPct = Number(raw.used_percent ?? 0);
  const resetAt = parseTime(raw.reset_at) || (raw.reset_after_seconds ? Date.now() + raw.reset_after_seconds * 1000 : null);
  const isSession = seconds > 0 && seconds <= 86400;
  return {
    id: isSession ? "session" : "weekly",
    label: isSession ? `${Math.round(seconds / 3600)}시간` : "주간",
    usedPct,
    remainingPct: remainingFromUsed(usedPct),
    resetAt,
  };
}

async function fetchUsage() {
  const auth = readJson(path.join(home(), ".codex", "auth.json"));
  const tokens = auth && auth.tokens;
  if (!tokens || !tokens.access_token) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "codex login 으로 ChatGPT 계정에 로그인하세요.",
    };
  }

  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (tokens.account_id) headers["chatgpt-account-id"] = tokens.account_id;

  const res = await requestJson("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (res.status === 401 || res.status === 403) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "세션이 만료되었습니다. codex login 을 다시 실행하세요.",
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
  const rate = data.rate_limit || {};
  const windows = [classifyWindow(rate.primary_window), classifyWindow(rate.secondary_window)].filter(Boolean);

  for (const extra of data.additional_rate_limits || []) {
    const nested = extra.rate_limit || {};
    const name = extra.limit_name || extra.metered_feature || "추가 한도";
    for (const raw of [nested.primary_window, nested.secondary_window]) {
      const win = classifyWindow(raw);
      if (!win) continue;
      windows.push({
        ...win,
        id: `${name}-${win.id}`,
        label: `${name} ${win.label}`,
      });
    }
  }

  const primary = windows[0] || null;
  const credits = data.credits || {};
  const extras = [];
  if (credits.balance != null) extras.push({ label: "크레딧", value: String(credits.balance) });
  if (rate.limit_reached) extras.push({ label: "상태", value: "한도 도달" });

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.plan_type,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    extras,
  };
}

module.exports = { id: ID, fetchUsage };
