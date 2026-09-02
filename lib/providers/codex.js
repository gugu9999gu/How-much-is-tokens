const path = require("path");
const { home, readJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { refreshManagedAuth } = require("../codex-app-server");

const ID = "codex";
const NAME = "Codex";
const BRAND = "#10a37f";

function authPath() {
  return path.join(home(), ".codex", "auth.json");
}

function classifyWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seconds = Number(raw.limit_window_seconds || 0);
  const usedPct = Number(raw.used_percent ?? 0);
  const resetAt = parseTime(raw.reset_at) || (raw.reset_after_seconds ? Date.now() + raw.reset_after_seconds * 1000 : null);
  const isSession = seconds > 0 && seconds <= 86400;
  const hours = isSession ? Math.round(seconds / 3600) : null;
  return {
    id: isSession ? "session" : "weekly",
    label: isSession ? `${hours}시간 한도` : "주간 한도",
    usedPct,
    remainingPct: remainingFromUsed(usedPct),
    resetAt,
  };
}

async function requestUsage(tokens) {
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (tokens.account_id) headers["chatgpt-account-id"] = tokens.account_id;
  return requestJson("https://chatgpt.com/backend-api/wham/usage", { headers });
}

function loginResult(tokens, refresh) {
  const detail = refresh && refresh.reason && refresh.reason !== "codex-not-found"
    ? ` (${refresh.reason})`
    : "";
  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "login",
    hint: `Codex 인증 갱신이 필요합니다${detail}. 마지막 유효 사용량은 위젯에 유지됩니다.`,
  };
}

async function fetchUsage() {
  let auth = readJson(authPath());
  let tokens = auth && auth.tokens;
  if (!tokens || !tokens.access_token) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "codex login 으로 ChatGPT 계정에 로그인하세요.",
    };
  }

  let res = await requestUsage(tokens);
  let refresh = null;

  if (res.status === 401 || res.status === 403) {
    // Use Codex's own stable app-server auth API so Codex itself owns refresh
    // token rotation/persistence. This runs no model turn and spends no quota.
    refresh = await refreshManagedAuth();
    if (refresh.ok) {
      auth = readJson(authPath());
      tokens = auth && auth.tokens;
      if (tokens && tokens.access_token) res = await requestUsage(tokens);
    }
  }

  if (res.status === 401 || res.status === 403) return loginResult(tokens, refresh);
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
  if (refresh && refresh.ok) extras.push({ label: "인증", value: "자동 갱신됨" });

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.plan_type || (refresh && refresh.account && refresh.account.planType),
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    extras,
  };
}

module.exports = { id: ID, fetchUsage, classifyWindow, requestUsage };
