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
const RESET_DETAIL_CACHE_MS = 3 * 60 * 1000;
const resetDetailCache = new Map();

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

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
}

function whamResetSummary(data) {
  const summary = data && data.rate_limit_reset_credits;
  if (!summary || typeof summary !== "object") return null;
  const availableCount = finiteCount(summary.available_count ?? summary.availableCount);
  if (availableCount == null) return null;
  return {
    availableCount,
    applicableCount: finiteCount(summary.applicable_available_count ?? summary.applicableAvailableCount),
    detailsProvided: false,
    tickets: [],
    source: "codex-wham-usage",
  };
}

function ticketFromWhamCredit(credit, now) {
  if (!credit || typeof credit !== "object") return null;
  const status = String(credit.status || "available").toLowerCase();
  if (status !== "available" && status !== "active") return null;
  const expiresAt = parseTime(credit.expires_at || credit.expiresAt);
  return {
    title: credit.title ? String(credit.title) : "Full Reset",
    expiresAt,
    expired: expiresAt != null && expiresAt <= now,
  };
}

function normalizeWhamResetCreditList(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  const availableCount = finiteCount(payload.available_count ?? payload.availableCount);
  const credits = Array.isArray(payload.credits) ? payload.credits : null;
  if (availableCount == null && !credits) return null;
  const tickets = (credits || [])
    .map((credit) => ticketFromWhamCredit(credit, now))
    .filter((ticket) => ticket && !ticket.expired);
  return {
    availableCount: availableCount == null ? tickets.length : availableCount,
    applicableCount: finiteCount(payload.applicable_available_count ?? payload.applicableAvailableCount),
    detailsProvided: Array.isArray(credits),
    tickets,
    source: "codex-wham-reset-credits",
  };
}

function mergeCodexResetTickets({ summary = null, details = null, appServer = null } = {}) {
  const availableCount = summary && summary.availableCount != null
    ? summary.availableCount
    : (appServer && appServer.availableCount != null
      ? appServer.availableCount
      : (details && details.availableCount != null ? details.availableCount : null));
  if (availableCount == null) return null;
  const detailTickets = details && Array.isArray(details.tickets) && details.tickets.length ? details.tickets : null;
  const tickets = detailTickets || (appServer && Array.isArray(appServer.tickets) ? appServer.tickets : []);
  const applicableCount = summary && summary.applicableCount != null
    ? summary.applicableCount
    : (details && details.applicableCount != null ? details.applicableCount : null);
  const nextExpiresAt = tickets
    .map((ticket) => Number(ticket.expiresAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0] || null;
  return {
    availableCount,
    applicableCount,
    detailsProvided: tickets.length > 0,
    tickets,
    nextExpiresAt,
    source: summary ? summary.source : (details ? details.source : "codex-app-server"),
  };
}

function publicResetCoupons(resetTickets) {
  if (!resetTickets || !Number.isFinite(Number(resetTickets.availableCount))) {
    return { visibility: "unknown", availableCount: null, tickets: [], source: "codex" };
  }
  const tickets = (Array.isArray(resetTickets.tickets) ? resetTickets.tickets : [])
    .slice(0, 3)
    .map((ticket) => ({
      title: ticket.title || "Full Reset",
      expiresAt: ticket.expiresAt == null ? null : Number(ticket.expiresAt),
    }));
  return {
    visibility: "known",
    availableCount: Math.max(0, Number(resetTickets.availableCount)),
    applicableCount: resetTickets.applicableCount == null ? null : Number(resetTickets.applicableCount),
    tickets,
    source: resetTickets.source || "codex",
  };
}

function resetTicketExtras(resetTickets, now = Date.now()) {
  if (!resetTickets || !Number.isFinite(Number(resetTickets.availableCount))) return [];
  const count = Math.max(0, Number(resetTickets.availableCount));
  let value = `${count}개`;
  if (resetTickets.applicableCount === 0 && count > 0) value += " · 적용 대기";
  const extras = [{ label: "리셋 쿠폰", value }];
  const tickets = Array.isArray(resetTickets.tickets) ? resetTickets.tickets : [];
  for (const ticket of tickets.slice(0, 3)) {
    extras.push({
      label: ticket.title || "Full Reset",
      value: ticketExpiryText(ticket.expiresAt, now),
    });
  }
  return extras;
}

function whamHeaders(tokens) {
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (tokens.account_id) headers["chatgpt-account-id"] = tokens.account_id;
  return headers;
}

async function requestUsage(tokens) {
  return requestJson("https://chatgpt.com/backend-api/wham/usage", { headers: whamHeaders(tokens) });
}

async function requestResetCredits(tokens) {
  return requestJson("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", {
    headers: whamHeaders(tokens),
  });
}

async function readWhamResetDetails(tokens, cacheKey) {
  const key = cacheKey || "default";
  const cached = resetDetailCache.get(key);
  if (cached && Date.now() - cached.at < RESET_DETAIL_CACHE_MS) return cached.value;
  let value = null;
  try {
    const detailResult = await requestResetCredits(tokens);
    if (detailResult.ok && detailResult.json) value = normalizeWhamResetCreditList(detailResult.json);
  } catch {
    value = null;
  }
  if (value) resetDetailCache.set(key, { at: Date.now(), value });
  return value;
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

function profileAutoResetEnabled(settings = {}, profile = null) {
  if (!profile) return settings.codexAutoUseReset === true;
  return Array.isArray(settings.codexAutoResetProfiles)
    && settings.codexAutoResetProfiles.includes(profile.id);
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

  // Reset-ticket spending is opt-in per account. The existing automation state
  // is keyed by the authenticated accountKey, so every account keeps an
  // independent limit-epoch fingerprint and idempotency guard.
  const automationSettings = {
    ...settings,
    codexAutoUseReset: profileAutoResetEnabled(settings, profile),
  };
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
  const summary = whamResetSummary(data);
  let details = null;
  if (summary && summary.availableCount > 0) {
    details = await readWhamResetDetails(tokens, accountKey || "codex");
  }
  const resetTickets = mergeCodexResetTickets({
    summary,
    details,
    appServer: rateLimitsRead.ok ? rateLimitsRead.resetTickets : null,
  });
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
    limitReached: rate.limit_reached === true,
    resetTickets,
    resetCoupons: publicResetCoupons(resetTickets),
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
  whamResetSummary,
  normalizeWhamResetCreditList,
  mergeCodexResetTickets,
  publicResetCoupons,
  resetTicketExtras,
  requestResetCredits,
  creditSnapshotFromRateLimits,
  creditBalances,
  windowsFromWham,
  autoResetExtra,
  profileAutoResetEnabled,
};
