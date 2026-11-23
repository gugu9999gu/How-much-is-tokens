const crypto = require("crypto");
const path = require("path");
const { home, readJson, writeJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const {
  amountFromMinor,
  amountFromObject,
  finiteNumber,
  remainingPercent,
} = require("../credit-balances");
const { readClaudeAccountFacts } = require("../claude-reset-credits");
const { planFromClaudeOauth } = require("../claude-plans");

const ID = "claude";
const NAME = "Claude";
const BRAND = "#d97757";
// Public Claude Code OAuth client. The installed CLI posts refresh grants here.
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_BACKOFF_MS = 30 * 1000;
const REFRESH_RATE_LIMIT_MS = 2 * 60 * 1000;
const refreshLocks = new Map();
const refreshNotBefore = new Map();

function credentialsPath(profile = null) {
  const dir = profile && profile.configDir
    ? profile.configDir
    : (process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
  return path.join(dir, ".credentials.json");
}

function windowFrom(raw, id, label) {
  if (!raw || typeof raw !== "object") return null;
  const usedPct = raw.utilization ?? raw.used_percentage ?? raw.usedPercent ?? raw.percent;
  if (usedPct == null || usedPct === "" || typeof usedPct === "boolean" ||
      !Number.isFinite(Number(usedPct))) return null;
  const used = Math.max(0, Math.min(100, Number(usedPct)));
  return {
    id,
    label,
    usedPct: used,
    remainingPct: remainingFromUsed(used),
    resetAt: parseTime(raw.resets_at || raw.reset_at || raw.resetsAt || raw.resetAt),
  };
}

function slug(value) {
  return String(value || "quota")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "") || "quota";
}

function modelNameFromLimit(limit) {
  if (!limit || typeof limit !== "object") return null;
  const model = (limit.scope && limit.scope.model) || limit.model;
  const value = typeof model === "string" ? model
    : (model && (model.display_name || model.displayName || model.name)) ||
      limit.display_name || limit.displayName || limit.model_name || limit.modelName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function structuredLimitLabel(limit) {
  const kind = String(limit && limit.kind || "").toLowerCase();
  const modelName = modelNameFromLimit(limit);
  const surface = limit && limit.scope && limit.scope.surface;
  if (kind === "session") return "5시간 한도";
  if (kind === "weekly_all") return "주간 한도";
  if (kind === "weekly_scoped" && modelName) return modelName + " 주간 한도";
  if (kind === "weekly_scoped" && surface) return surface + " 주간 한도";
  if (kind === "weekly_scoped") return "모델별 주간 한도";
  if (kind.includes("weekly") && modelName) return modelName + " 주간 한도";
  if (kind.includes("weekly")) return "주간 한도";
  if (modelName) return modelName + " 한도";
  return kind ? kind.replace(/_/g, " ") + " 한도" : "추가 한도";
}

function structuredWindows(data) {
  const rows = [];
  const seen = new Set();
  const limits = Array.isArray(data && data.limits) ? data.limits : [];
  // Each account can report model quotas in limits[] or model_scoped[].
  // The latter uses top-level display_name rather than scope.model.
  const scopedLists = [
    data && data.model_scoped,
    data && data.modelScoped,
    data && data.rate_limits && data.rate_limits.model_scoped,
    data && data.rate_limits && data.rate_limits.modelScoped,
    data && data.rateLimits && data.rateLimits.model_scoped,
    data && data.rateLimits && data.rateLimits.modelScoped,
  ];

  function append(limit, defaultKind = null) {
    if (!limit || typeof limit !== "object") return;
    const kind = String(limit.kind || defaultKind || "limit").toLowerCase();
    const modelName = modelNameFromLimit(limit);
    // An unlabeled scoped row is not evidence that it belongs to Fable.
    if (defaultKind === "weekly_scoped" && !modelName) return;
    const scope = limit.scope && typeof limit.scope === "object" ? limit.scope : {};
    const surface = typeof scope.surface === "string" ? scope.surface : null;
    const id = slug(kind) + (modelName ? "-" + slug(modelName) : surface ? "-" + slug(surface) : "");
    if (seen.has(id)) return;
    const normalized = { ...limit, kind };
    const window = windowFrom(normalized, id, structuredLimitLabel(normalized));
    if (!window) return;
    window.source = "claude-oauth-limits";
    seen.add(id);
    rows.push(window);
  }

  for (const limit of limits) append(limit);
  for (const candidates of scopedLists) {
    if (!Array.isArray(candidates)) continue;
    for (const limit of candidates) append(limit, "weekly_scoped");
  }
  return rows;
}

function legacyWindows(data) {
  if (!data || typeof data !== "object") return [];
  const nested = data.rate_limits || data.rateLimits || {};
  const read = (key) => data[key] ?? nested[key];
  // Two compatibility fields refer to the same Fable weekly pool.
  const fable = windowFrom(read("seven_day_overage_included"), "fable", "Fable 주간 한도")
    || windowFrom(read("seven_day_fable"), "fable", "Fable 주간 한도");
  return [
    windowFrom(read("five_hour"), "five_hour", "5시간 한도"),
    windowFrom(read("seven_day"), "seven_day", "주간 한도"),
    windowFrom(read("seven_day_sonnet"), "sonnet", "Sonnet 주간 한도"),
    windowFrom(read("seven_day_opus"), "opus", "Opus 주간 한도"),
    fable,
  ].filter(Boolean);
}

function sameWindow(a, b) {
  if (!a || !b) return false;
  // Prefer canonical structured data when the legacy window is the same pool,
  // even when their percentages or reset times are not perfectly synchronized.
  if (a.id === b.id) return true;
  if (a.label && b.label && a.label.toLowerCase() === b.label.toLowerCase() &&
      a.label !== "모델별 주간 한도") return true;
  const samePct = Math.abs(Number(a.usedPct) - Number(b.usedPct)) < 0.01;
  const ar = Number(a.resetAt || 0);
  const br = Number(b.resetAt || 0);
  const sameReset = (!ar && !br) || Math.abs(ar - br) <= 60 * 1000;
  if (!samePct || !sameReset) return false;
  const al = String(a.label || "").toLowerCase();
  const bl = String(b.label || "").toLowerCase();
  const sessionLike = (win, label) => win.id === "session" || win.id === "five_hour" ||
    label.includes("세션") || label.includes("5시간");
  return sessionLike(a, al) && sessionLike(b, bl);
}

function allUsageWindows(data) {
  const structured = structuredWindows(data);
  const legacy = legacyWindows(data);
  if (!structured.length) return legacy;
  const merged = [...structured];
  for (const win of legacy) {
    if (!merged.some((existing) => sameWindow(existing, win))) merged.push(win);
  }
  return merged;
}

function currencyCode(raw) {
  return String(raw || "USD").toUpperCase();
}

function extraUsageCreditBalance(extraUsage) {
  if (!extraUsage || typeof extraUsage !== "object") return null;
  const decimalPlaces = finiteNumber(extraUsage.decimal_places);
  const exponent = decimalPlaces == null ? 2 : decimalPlaces;
  const limit = amountFromMinor(extraUsage.monthly_limit, exponent);
  const used = amountFromMinor(extraUsage.used_credits, exponent);
  if (limit == null && used == null && extraUsage.is_enabled !== true) return null;
  const normalizedLimit = limit == null ? null : Math.max(0, limit);
  const normalizedUsed = used == null ? null : Math.max(0, used);
  const balance = normalizedLimit != null && normalizedUsed != null
    ? Math.max(0, normalizedLimit - normalizedUsed)
    : null;
  const remainingPct = finiteNumber(extraUsage.utilization) != null
    ? remainingFromUsed(Math.max(0, Math.min(100, Number(extraUsage.utilization))))
    : remainingPercent(balance, normalizedLimit);
  return {
    id: "usage-credits",
    label: "Usage Credits",
    balance,
    used: normalizedUsed,
    limit: normalizedLimit,
    remainingPct,
    currency: currencyCode(extraUsage.currency),
    resetAt: parseTime(extraUsage.resets_at || extraUsage.reset_at),
    source: "claude-extra-usage",
  };
}

function spendCreditBalance(spend) {
  if (!spend || typeof spend !== "object") return null;
  const used = amountFromObject(spend.used);
  const limit = amountFromObject(spend.limit || spend.cap);
  let balance = amountFromObject(spend.balance);
  if (balance == null && limit != null && used != null) balance = Math.max(0, limit - used);
  if (balance == null && used == null && limit == null) return null;
  return {
    id: "usage-credits",
    label: "Usage Credits",
    balance: balance == null ? null : Math.max(0, balance),
    used: used == null ? null : Math.max(0, used),
    limit: limit == null ? null : Math.max(0, limit),
    remainingPct: finiteNumber(spend.percent) != null
      ? remainingFromUsed(Math.max(0, Math.min(100, Number(spend.percent))))
      : remainingPercent(balance, limit),
    currency: currencyCode(spend.currency || (spend.used && spend.used.currency)),
    resetAt: parseTime(spend.resets_at || spend.reset_at),
    source: "claude-spend",
  };
}

function creditBalances(data) {
  const spend = spendCreditBalance(data && data.spend);
  if (spend) return [spend];
  const extra = extraUsageCreditBalance(data && data.extra_usage);
  return extra ? [extra] : [];
}

function epochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function claudeOauth(file) {
  const oauth = file && file.claudeAiOauth;
  return oauth && typeof oauth === "object" ? oauth : null;
}

function isFreshAccess(oauth, now = Date.now()) {
  if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) return false;
  const expires = epochMs(oauth.expiresAt);
  if (expires == null) return true;
  return expires > now + TOKEN_REFRESH_SKEW_MS;
}

function canRefresh(oauth, now = Date.now()) {
  if (!oauth || typeof oauth.refreshToken !== "string" || !oauth.refreshToken) return false;
  const expires = epochMs(oauth.refreshTokenExpiresAt);
  return expires == null || expires > now;
}

function hasStoredClaudeLogin(file) {
  const oauth = claudeOauth(file);
  if (!oauth) return false;
  return Boolean(oauth.accessToken || oauth.refreshToken);
}

function accountIdFromOauth(oauth) {
  if (!oauth) return null;
  return oauth.accountUuid || oauth.accountUUID || oauth.organizationUuid || oauth.userId || null;
}

function planFromOauth(oauth) {
  return planFromClaudeOauth(oauth);
}

function refreshScope(oauth) {
  if (!oauth || !Array.isArray(oauth.scopes)) return "";
  return oauth.scopes
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())
    .join(" ");
}

function noteRefreshFailure(filePath, res, now) {
  const delay = res && res.status === 429 ? REFRESH_RATE_LIMIT_MS : REFRESH_BACKOFF_MS;
  refreshNotBefore.set(filePath, now + delay);
}

function refreshBlocked(filePath, now) {
  return (refreshNotBefore.get(filePath) || 0) > now;
}

function claudeFactsCacheKey(token) {
  if (typeof token !== "string" || !token) return null;
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
}

function missingClaude(profile) {
  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "missing",
    hint: profile
      ? "이 Claude 프로필에 로그인 정보가 없습니다. 해당 CLAUDE_CONFIG_DIR에서 claude 로그인을 실행하세요."
      : "Claude Code에서 로그인한 뒤 다시 새로고침하세요.",
  };
}

function loginClaude(oauth) {
  return {
    id: ID,
    accountKey: stableAccountKey(ID, accountIdFromOauth(oauth)),
    name: NAME,
    brand: BRAND,
    plan: planFromOauth(oauth),
    status: "login",
    hint: "Claude 인증 갱신이 필요합니다. 마지막 유효 사용량은 위젯에 유지됩니다.",
  };
}

async function refreshClaudeOauth(filePath, refreshToken, requestImpl, now) {
  const oauth = claudeOauth(readJson(filePath));
  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  };
  const scope = refreshScope(oauth);
  if (scope) body.scope = scope;
  const res = await requestImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });
  const payload = res && res.json;
  const nextToken = payload && payload.access_token;
  if (!res || !res.ok || typeof nextToken !== "string" || !nextToken) {
    noteRefreshFailure(filePath, res, now);
    return null;
  }
  refreshNotBefore.delete(filePath);

  const current = readJson(filePath);
  const stored = claudeOauth(current);
  if (!stored) return null;
  // Another writer rotated the grant while this request was in flight.
  if (stored.refreshToken !== refreshToken) {
    if (isFreshAccess(stored, now)) return { token: stored.accessToken, refreshed: true, oauth: stored };
    return null;
  }

  const expiresIn = Number(payload.expires_in);
  const nextOauth = {
    ...stored,
    accessToken: nextToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : now + 30 * 60 * 1000,
  };
  if (typeof payload.refresh_token === "string" && payload.refresh_token) {
    nextOauth.refreshToken = payload.refresh_token;
  }
  if (typeof payload.scope === "string" && payload.scope.trim()) {
    nextOauth.scopes = payload.scope.split(/\s+/).filter(Boolean);
  }
  const refreshExpiresIn = Number(payload.refresh_token_expires_in);
  if (Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0) {
    nextOauth.refreshTokenExpiresAt = now + refreshExpiresIn * 1000;
  }
  current.claudeAiOauth = nextOauth;
  writeJson(filePath, current);
  return { token: nextToken, refreshed: true, oauth: nextOauth };
}

async function ensureClaudeAuth(profile = null, options = {}) {
  const now = Number(options.now) || Date.now();
  const requestImpl = options.requestJson || requestJson;
  const filePath = options.credentialsFile || credentialsPath(profile);
  const oauth = claudeOauth(readJson(filePath));
  if (!options.force && isFreshAccess(oauth, now)) {
    return { token: oauth.accessToken, refreshed: false, oauth };
  }
  if (!canRefresh(oauth, now)) return null;
  if (refreshBlocked(filePath, now)) {
    if (isFreshAccess(oauth, now)) return { token: oauth.accessToken, refreshed: false, oauth };
    return null;
  }

  const pending = refreshLocks.get(filePath);
  if (pending) return pending;
  const task = refreshClaudeOauth(filePath, oauth.refreshToken, requestImpl, now)
    .catch(() => {
      noteRefreshFailure(filePath, null, now);
      return null;
    })
    .then((refreshed) => {
      if (refreshed) return refreshed;
      const latest = claudeOauth(readJson(filePath));
      if (!isFreshAccess(latest, now)) return null;
      return { token: latest.accessToken, refreshed: true, oauth: latest };
    })
    .finally(() => refreshLocks.delete(filePath));
  refreshLocks.set(filePath, task);
  return task;
}

async function requestUsage(token, requestImpl) {
  return requestImpl("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "User-Agent": "claude-code/2.1.255",
      "x-app": "cli",
      Accept: "application/json",
    },
  });
}

async function fetchUsage(_settings = {}, _secrets = {}, profile = null, options = {}) {
  const filePath = options.credentialsFile || credentialsPath(profile);
  const requestImpl = options.requestJson || requestJson;
  let auth = await ensureClaudeAuth(profile, { ...options, credentialsFile: filePath, requestJson: requestImpl });
  if (!auth) {
    const file = readJson(filePath);
    return hasStoredClaudeLogin(file) ? loginClaude(claudeOauth(file)) : missingClaude(profile);
  }

  let res = await requestUsage(auth.token, requestImpl);
  if (res.status === 401 && !auth.refreshed) {
    const retried = await ensureClaudeAuth(profile, {
      ...options,
      credentialsFile: filePath,
      requestJson: requestImpl,
      force: true,
    });
    if (retried && retried.token) {
      auth = retried;
      res = await requestUsage(auth.token, requestImpl);
    }
  }

  const oauth = (auth && auth.oauth) || claudeOauth(readJson(filePath));
  const accountKey = stableAccountKey(ID, accountIdFromOauth(oauth));
  if (res.status === 401 || res.status === 403) {
    return loginClaude(oauth);
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: res.error || `HTTP ${res.status}`,
      hint: "Claude 사용량 API에 연결하지 못했습니다.",
    };
  }

  const data = res.json;
  const windows = allUsageWindows(data);
  const primary = windows.find((win) => win.id === "session" || win.id === "five_hour") || windows[0] || null;
  const balances = creditBalances(data);
  const extras = [];
  const extraUsage = data.extra_usage;
  if (extraUsage && extraUsage.is_enabled === false && extraUsage.disabled_reason) {
    extras.push({ label: "Usage Credits", value: `비활성 · ${extraUsage.disabled_reason}` });
  }

  let accountFacts = {
    resetCoupons: { visibility: "unknown", availableCount: null, tickets: [], source: "claude-oauth-usage" },
    billing: null,
  };
  try {
    accountFacts = await readClaudeAccountFacts(auth.token, data, {
      cacheKey: claudeFactsCacheKey(auth.token),
      requestJson: options.requestJson,
    });
  } catch {
    // Keep the unknown coupon state. A failed probe must not invent a zero balance.
  }

  const identity = accountFacts.identity || {};
  const identityFields = {};
  if (identity.accountEmail) identityFields.accountEmail = identity.accountEmail;
  if (identity.accountLogin) identityFields.accountLogin = identity.accountLogin;
  if (identity.accountId) identityFields.accountId = identity.accountId;
  if (identity.accountIdentityLabel) identityFields.accountIdentityLabel = identity.accountIdentityLabel;
  const oauthPlan = planFromOauth(oauth);
  const billingPlan = accountFacts.billing && accountFacts.billing.planLabel;
  const plan = accountFacts.billing && accountFacts.billing.planLabelSource === "explicit"
    ? billingPlan
    : (oauthPlan === "Ultra" ? "Ultra" : (billingPlan || oauthPlan));
  if (!windows.some((win) => /\bfable\b/i.test(win.id + " " + win.label))) {
    extras.push({
      label: "Fable",
      value: plan === "Pro"
        ? "별도 주간 한도 없음 · 크레딧 기반"
        : "API에 모델별 한도 미제공",
    });
  }
  return {
    id: ID,
    accountKey,
    ...identityFields,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    creditBalances: balances,
    extras,
    resetCoupons: accountFacts.resetCoupons,
    billing: accountFacts.billing,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  claudeFactsCacheKey,
  credentialsPath,
  ensureClaudeAuth,
  isFreshAccess,
  canRefresh,
  OAUTH_TOKEN_URL,
  OAUTH_CLIENT_ID,
  planFromOauth,
  windowFrom,
  modelNameFromLimit,
  structuredLimitLabel,
  structuredWindows,
  legacyWindows,
  allUsageWindows,
  extraUsageCreditBalance,
  spendCreditBalance,
  creditBalances,
};
