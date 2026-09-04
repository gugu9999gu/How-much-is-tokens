const path = require("path");
const { home, readJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { refreshManagedAuth } = require("../codex-app-server");
const { readAccountRateLimits } = require("../codex-rate-limits");
const { maybeAutoConsumeReset } = require("../codex-auto-reset");
const { stableAccountKey } = require("../account-identity");
const { finiteNumber, remainingPercent } = require("../credit-balances");
const { profileEnvironment } = require("../account-profiles");

const ID = "codex";
const NAME = "Codex";
const BRAND = "#10a37f";
const DAY_MS = 24 * 60 * 60 * 1000;

function codexHome(profile = null) {
  if (profile && profile.configDir) return profile.configDir;
  return process.env.CODEX_HOME || path.join(home(), ".codex");
}

function authPath(profile = null) {
  return path.join(codexHome(profile), "auth.json");
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

function ticketExpiryText(expiresAt, now = Date.now()) {
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= 0) return "만료 없음";
  const expiry = Number(expiresAt);
  const date = new Date(expiry).toISOString().slice(0, 10);
  const delta = expiry - now;
  if (delta <= 0) return `${date} 만료`;
  const days = Math.max(1, Math.ceil(delta / DAY_MS));
  return `D-${days} · ${date}`;
}

function resetTicketExtras(resetTickets, now = Date.now()) {
  if (!resetTickets || !Number.isFinite(Number(resetTickets.availableCount))) return [];
  const extras = [{ label: "Codex/Work 리셋", value: `${Math.max(0, Number(resetTickets.availableCount))}개` }];
  const tickets = Array.isArray(resetTickets.tickets) ? resetTickets.tickets : [];
  for (const ticket of tickets.slice(0, 3)) {
    extras.push({
      label: ticket.title || "Full Reset",
      value: ticketExpiryText(ticket.expiresAt, now),
    });
  }
  return extras;
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

function loginResult(tokens, refresh, accountKey = null) {
  const detail = refresh && refresh.reason && refresh.reason !== "codex-not-found"
    ? ` (${refresh.reason})`
    : "";
  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "login",
    hint: `Codex 인증 갱신이 필요합니다${detail}. 마지막 유효 사용량은 위젯에 유지됩니다.`,
  };
}

function creditSnapshotFromRateLimits(rateLimitsRead) {
  const response = rateLimitsRead && rateLimitsRead.ok && rateLimitsRead.response;
  const rate = response && response.rateLimits;
  if (!rate || typeof rate !== "object") return [];
  const balances = [];

  const credits = rate.credits;
  if (credits && typeof credits === "object") {
    const balance = finiteNumber(credits.balance);
    if (balance != null || credits.unlimited === true) {
      balances.push({
        id: "workspace-credits",
        label: "보유 크레딧",
        balance,
        used: null,
        limit: null,
        unit: "크레딧",
        remainingPct: null,
        resetAt: null,
        unlimited: credits.unlimited === true,
        source: "codex-app-server-credits",
      });
    }
  }

  const individual = rate.individualLimit;
  if (individual && typeof individual === "object") {
    const limit = finiteNumber(individual.limit);
    const used = finiteNumber(individual.used);
    const balance = limit != null && used != null ? Math.max(0, limit - used) : null;
    let remainingPct = finiteNumber(individual.remainingPercent);
    if (remainingPct == null) remainingPct = remainingPercent(balance, limit);
    balances.push({
      id: "monthly-credit-limit",
      label: "월간 크레딧 한도",
      balance,
      used,
      limit,
      unit: "크레딧",
      remainingPct,
      resetAt: individual.resetsAt == null ? null : Number(individual.resetsAt) * 1000,
      source: "codex-app-server-individual-limit",
    });
  }
  return balances;
}

function creditBalances(data, rateLimitsRead) {
  const balances = creditSnapshotFromRateLimits(rateLimitsRead);
  const whamBalance = data && data.credits && finiteNumber(data.credits.balance);
  if (whamBalance != null && !balances.some((item) => item.id === "workspace-credits")) {
    balances.unshift({
      id: "wham-credits",
      label: "보유 크레딧",
      balance: whamBalance,
      used: null,
      limit: null,
      unit: "크레딧",
      remainingPct: null,
      resetAt: null,
      source: "codex-wham-credits",
    });
  }
  return balances;
}

function windowsFromWham(data) {
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
  return windows;
}

function autoResetExtra(autoReset) {
  if (!autoReset || autoReset.attempted !== true) return null;
  if (autoReset.ok && ["reset", "alreadyRedeemed"].includes(autoReset.outcome)) {
    return { label: "자동 리셋", value: "티켓 사용 완료" };
  }
  if (autoReset.outcome === "nothingToReset") return { label: "자동 리셋", value: "리셋 대상 없음" };
  if (autoReset.outcome === "noCredit") return { label: "자동 리셋", value: "티켓 없음" };
  return { label: "자동 리셋", value: `실패 · ${autoReset.outcome || "error"}` };
}

async function fetchUsage(settings = {}, _secrets = {}, profile = null) {
  const runtimeEnv = profileEnvironment(profile);
  let auth = readJson(authPath(profile));
  let tokens = auth && auth.tokens;
  if (!tokens || !tokens.access_token) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: profile
        ? "이 Codex 프로필에 로그인 정보가 없습니다. 해당 CODEX_HOME에서 codex login을 실행하세요."
        : "codex login 으로 ChatGPT 계정에 로그인하세요.",
    };
  }

  let accountKey = stableAccountKey(ID, tokens.account_id || tokens.accountId || null);
  let res = await requestUsage(tokens);
  let refresh = null;

  if (res.status === 401 || res.status === 403) {
    refresh = await refreshManagedAuth({ env: runtimeEnv });
    if (refresh.ok) {
      auth = readJson(authPath(profile));
      tokens = auth && auth.tokens;
      if (tokens && tokens.access_token) {
        accountKey = stableAccountKey(ID, tokens.account_id || tokens.accountId || null);
        res = await requestUsage(tokens);
      }
    }
  }

  if (res.status === 401 || res.status === 403) return loginResult(tokens, refresh, accountKey);
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

  let data = res.json;
  let rateLimitsRead = await readAccountRateLimits({ env: runtimeEnv });
  if (rateLimitsRead.ok && rateLimitsRead.response && rateLimitsRead.response.accountId) {
    accountKey = stableAccountKey(ID, rateLimitsRead.response.accountId);
  }

  // Additional profiles are display-only in v1.0.22. A single global toggle
  // must never spend reset tickets from every registered account. Per-profile
  // automation controls can opt profiles in explicitly in a later router step.
  const automationSettings = profile
    ? { ...settings, codexAutoUseReset: false }
    : settings;
  const autoReset = await maybeAutoConsumeReset({
    settings: automationSettings,
    accountKey,
    rateLimitsRead,
    consumeOptions: { env: runtimeEnv },
  });

  if (autoReset.ok && ["reset", "alreadyRedeemed"].includes(autoReset.outcome)) {
    const [freshRateLimits, freshUsage] = await Promise.all([
      readAccountRateLimits({ env: runtimeEnv }),
      requestUsage(tokens),
    ]);
    if (freshRateLimits.ok) rateLimitsRead = freshRateLimits;
    if (freshUsage.ok && freshUsage.json) data = freshUsage.json;
  }

  const rate = data.rate_limit || {};
  const windows = windowsFromWham(data);
  const resetTickets = rateLimitsRead.ok ? rateLimitsRead.resetTickets : null;
  const primary = windows[0] || null;
  const extras = resetTicketExtras(resetTickets);
  const automatic = autoResetExtra(autoReset);
  if (automatic) extras.unshift(automatic);
  if (rate.limit_reached) extras.push({ label: "상태", value: "한도 도달" });
  if (refresh && refresh.ok) extras.push({ label: "인증", value: "자동 갱신됨" });

  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.plan_type ||
      (rateLimitsRead.ok && rateLimitsRead.response && rateLimitsRead.response.rateLimits && rateLimitsRead.response.rateLimits.planType) ||
      (refresh && refresh.account && refresh.account.planType),
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    resetTickets,
    autoReset,
    windows,
    creditBalances: creditBalances(data, rateLimitsRead),
    extras,
    maxExtras: 7,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  codexHome,
  authPath,
  classifyWindow,
  requestUsage,
  ticketExpiryText,
  resetTicketExtras,
  creditSnapshotFromRateLimits,
  creditBalances,
  windowsFromWham,
  autoResetExtra,
};
