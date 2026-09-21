const fs = require("fs");
const path = require("path");
const { home, readJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const {
  amountFromMinor,
  amountFromObject,
  finiteNumber,
  remainingPercent,
} = require("../credit-balances");

const ID = "claude";
const NAME = "Claude";
const BRAND = "#d97757";
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = CACHE_MAX_AGE_MS;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const retryBackoffByAccount = new Map();
const inMemoryUsageByAccount = new Map();

function configDir(profile = null) {
  return profile && profile.configDir
    ? profile.configDir
    : (process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
}

function credentialsPath(profile = null) {
  return path.join(configDir(profile), ".credentials.json");
}

function claudeConfigPath(profile = null, existsSync = fs.existsSync) {
  const customDir = profile && profile.configDir
    ? profile.configDir
    : process.env.CLAUDE_CONFIG_DIR;
  if (!customDir) return path.join(home(), ".claude.json");
  const configV5 = path.join(customDir, ".config.json");
  return existsSync(configV5) ? configV5 : path.join(customDir, ".claude.json");
}

function windowFrom(raw, id, label) {
  if (!raw || typeof raw !== "object") return null;
  const usedPct = raw.utilization ?? raw.used_percentage ?? raw.percent;
  if (usedPct == null || !Number.isFinite(Number(usedPct))) return null;
  const used = Math.max(0, Math.min(100, Number(usedPct)));
  return {
    id,
    label,
    usedPct: used,
    remainingPct: remainingFromUsed(used),
    resetAt: parseTime(raw.resets_at || raw.reset_at),
  };
}

function slug(value) {
  return String(value || "quota")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "") || "quota";
}

function structuredLimitLabel(limit) {
  const kind = String(limit && limit.kind || "").toLowerCase();
  const model = limit && limit.scope && limit.scope.model;
  const modelName = model && (model.display_name || model.displayName || model.name);
  const surface = limit && limit.scope && limit.scope.surface;
  if (kind === "session") return "세션 한도";
  if (kind === "weekly_all") return "주간 한도";
  if (kind === "weekly_scoped" && modelName) return `${modelName} 주간 한도`;
  if (kind === "weekly_scoped" && surface) return `${surface} 주간 한도`;
  if (kind.includes("weekly") && modelName) return `${modelName} 주간 한도`;
  if (kind.includes("weekly")) return "주간 한도";
  if (modelName) return `${modelName} 한도`;
  return kind ? `${kind.replace(/_/g, " ")} 한도` : "추가 한도";
}

function structuredWindows(data) {
  const rows = [];
  const candidates = [];
  if (Array.isArray(data && data.limits)) candidates.push(...data.limits);
  if (Array.isArray(data && data.model_scoped)) candidates.push(...data.model_scoped);
  if (Array.isArray(data && data.modelScoped)) candidates.push(...data.modelScoped);

  for (const limit of candidates) {
    if (!limit || typeof limit !== "object") continue;
    const win = windowFrom(limit, "structured", structuredLimitLabel(limit));
    if (!win) continue;
    const model = limit.scope && limit.scope.model;
    const modelName = model && (model.display_name || model.displayName || model.name);
    const kind = String(limit.kind || "limit");
    win.id = `${slug(kind)}${modelName ? `-${slug(modelName)}` : ""}`;
    win.source = "claude-oauth-limits";
    rows.push(win);
  }
  return rows;
}

function legacyWindows(data) {
  // `limits[]` is canonical on current Claude clients. Flat keys are retained
  // only for known compatibility buckets. Do not guess model names from
  // arbitrary seven_day_* keys because Anthropic also emits internal codenames.
  return [
    windowFrom(data.five_hour, "five_hour", "5시간 한도"),
    windowFrom(data.seven_day, "seven_day", "주간 한도"),
    windowFrom(data.seven_day_sonnet, "sonnet", "Sonnet 주간 한도"),
    windowFrom(data.seven_day_opus, "opus", "Opus 주간 한도"),
    windowFrom(data.seven_day_fable, "fable", "Fable 주간 한도"),
    windowFrom(data.seven_day_overage_included, "fable", "Fable 주간 한도"),
  ].filter(Boolean);
}

function sameWindow(a, b) {
  if (!a || !b) return false;
  const samePct = Math.abs(Number(a.usedPct) - Number(b.usedPct)) < 0.01;
  const ar = Number(a.resetAt || 0);
  const br = Number(b.resetAt || 0);
  const sameReset = (!ar && !br) || Math.abs(ar - br) <= 60 * 1000;
  if (!samePct || !sameReset) return false;
  if (a.id === b.id) return true;
  const al = String(a.label || "").toLowerCase();
  const bl = String(b.label || "").toLowerCase();
  if (al === bl) return true;
  const genericWeekly = (label) => label.includes("주간") && !label.includes("sonnet") && !label.includes("opus") && !label.includes("fable");
  if (genericWeekly(al) && genericWeekly(bl)) return true;
  const sessionLike = (win, label) => win.id === "session" || win.id === "five_hour" || label.includes("세션") || label.includes("5시간");
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

function oauthAccountId(oauth, config = null) {
  const configured = config && config.oauthAccount;
  return oauth && (oauth.accountUuid || oauth.accountUUID)
    || configured && (configured.accountUuid || configured.accountUUID)
    || undefined;
}

function cachedUsageSnapshot(config, oauth, now = Date.now()) {
  const cached = config && config.cachedUsageUtilization;
  if (!cached || typeof cached !== "object") return null;
  const fetchedAtMs = Number(cached.fetchedAtMs);
  if (!Number.isFinite(fetchedAtMs)) return null;
  const ageMs = now - fetchedAtMs;
  if (ageMs < 0 || ageMs > STALE_CACHE_MAX_AGE_MS) return null;
  if (cached.accountUuid !== oauthAccountId(oauth, config)) return null;
  const data = cached.utilization;
  if (!data || typeof data !== "object") return null;
  if (!allUsageWindows(data).length && !creditBalances(data).length) return null;
  return {
    data,
    fetchedAtMs,
    ageMs,
    fresh: ageMs <= CACHE_MAX_AGE_MS,
    source: "claude-code",
  };
}

function memoryUsageSnapshot(accountKey, now) {
  const cached = inMemoryUsageByAccount.get(accountKey);
  if (!cached) return null;
  const ageMs = now - cached.fetchedAtMs;
  if (ageMs < 0 || ageMs > STALE_CACHE_MAX_AGE_MS) {
    inMemoryUsageByAccount.delete(accountKey);
    return null;
  }
  return {
    ...cached,
    ageMs,
    fresh: ageMs <= CACHE_MAX_AGE_MS,
    source: "widget-memory",
  };
}

function newestSnapshot(...snapshots) {
  return snapshots
    .filter(Boolean)
    .sort((a, b) => Number(b.fetchedAtMs) - Number(a.fetchedAtMs))[0] || null;
}

function retryAfterMs(value, now = Date.now()) {
  const seconds = Number(value);
  let delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Date.parse(String(value || "")) - now;
  if (!Number.isFinite(delay) || delay < 0) delay = DEFAULT_RETRY_AFTER_MS;
  return Math.max(1000, Math.min(MAX_RETRY_AFTER_MS, delay));
}

function responseHeader(res, name) {
  if (!res || !res.headers) return null;
  if (typeof res.headers.get === "function") return res.headers.get(name);
  const lower = String(name).toLowerCase();
  return res.headers[lower] ?? res.headers[name] ?? null;
}

function retryHint(until, now) {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  return `Claude 요청 제한으로 최근 사용량을 표시합니다. 약 ${minutes}분 후 자동으로 다시 조회합니다.`;
}

function buildUsageResult(data, oauth, accountKey, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  let windows = allUsageWindows(data);
  if (options.fromCache) {
    windows = windows.filter((win) => !win.resetAt || Number(win.resetAt) > now);
  }
  const primary = windows.find((win) => win.id === "session" || win.id === "five_hour") || windows[0] || null;
  const balances = creditBalances(data);
  const extras = [];
  const extraUsage = data.extra_usage;
  if (extraUsage && extraUsage.is_enabled === false && extraUsage.disabled_reason) {
    extras.push({ label: "Usage Credits", value: `비활성 · ${extraUsage.disabled_reason}` });
  }
  if (options.stale) extras.unshift({ label: "상태", value: "Claude Code의 최근 사용량" });

  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: oauth.rateLimitTier || oauth.subscriptionType,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    creditBalances: balances,
    extras,
    cacheSource: options.cacheSource,
    cacheFetchedAt: options.cacheFetchedAt,
    stale: options.stale === true || undefined,
    staleReason: options.stale ? "Claude usage API 재시도 대기" : undefined,
    liveStatus: options.stale ? "error" : undefined,
    error: options.error,
    hint: options.hint,
  };
}

function cachedResult(snapshot, oauth, accountKey, now, options = {}) {
  return buildUsageResult(snapshot.data, oauth, accountKey, {
    now,
    fromCache: true,
    cacheSource: snapshot.source,
    cacheFetchedAt: snapshot.fetchedAtMs,
    ...options,
  });
}

function errorResult(accountKey, oauth, error, hint) {
  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    plan: oauth.rateLimitTier || oauth.subscriptionType,
    status: "error",
    error,
    hint,
  };
}

function clearRetryBackoffForTests() {
  retryBackoffByAccount.clear();
  inMemoryUsageByAccount.clear();
}

async function fetchUsage(_settings = {}, _secrets = {}, profile = null, dependencies = {}) {
  const read = dependencies.readJson || readJson;
  const request = dependencies.requestJson || requestJson;
  const existsSync = dependencies.existsSync || fs.existsSync;
  const now = typeof dependencies.now === "function" ? Number(dependencies.now()) : Date.now();
  const file = read(credentialsPath(profile));
  const oauth = file && file.claudeAiOauth;
  if (!oauth || !oauth.accessToken) {
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

  const config = read(claudeConfigPath(profile, existsSync));
  const accountKey = stableAccountKey(ID, oauthAccountId(oauth, config) || oauth.organizationUuid || oauth.userId || null);
  const requestKey = accountKey || credentialsPath(profile);
  const localCache = cachedUsageSnapshot(config, oauth, now);
  const memoryCache = memoryUsageSnapshot(requestKey, now);
  const cached = newestSnapshot(localCache, memoryCache);
  if (cached && cached.fresh) return cachedResult(cached, oauth, accountKey, now);

  const blockedUntil = retryBackoffByAccount.get(requestKey) || 0;
  if (blockedUntil > now) {
    const hint = retryHint(blockedUntil, now);
    if (cached) return cachedResult(cached, oauth, accountKey, now, { stale: true, error: "HTTP 429", hint });
    return errorResult(accountKey, oauth, "HTTP 429", hint);
  }

  const res = await request("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "User-Agent": "claude-code/2.1.255",
      "x-app": "cli",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (res.status === 401 || res.status === 403) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      plan: oauth.subscriptionType || oauth.rateLimitTier,
      status: "login",
      hint: "Claude 인증 갱신이 필요합니다. 마지막 유효 사용량은 위젯에 유지됩니다.",
    };
  }
  if (res.status === 429) {
    const delay = retryAfterMs(responseHeader(res, "retry-after"), now);
    const until = now + delay;
    retryBackoffByAccount.set(requestKey, until);
    const hint = retryHint(until, now);
    if (cached) return cachedResult(cached, oauth, accountKey, now, { stale: true, error: "HTTP 429", hint });
    return errorResult(accountKey, oauth, "HTTP 429", hint);
  }
  if (!res.ok || !res.json) {
    const error = res.error || `HTTP ${res.status}`;
    const hint = "Claude 사용량 API에 연결하지 못했습니다.";
    if (cached) return cachedResult(cached, oauth, accountKey, now, { stale: true, error, hint });
    return errorResult(accountKey, oauth, error, hint);
  }

  const data = res.json;
  retryBackoffByAccount.delete(requestKey);
  inMemoryUsageByAccount.set(requestKey, { data, fetchedAtMs: now });
  return buildUsageResult(data, oauth, accountKey, { now });
}

module.exports = {
  id: ID,
  fetchUsage,
  credentialsPath,
  claudeConfigPath,
  cachedUsageSnapshot,
  retryAfterMs,
  buildUsageResult,
  clearRetryBackoffForTests,
  windowFrom,
  structuredLimitLabel,
  structuredWindows,
  legacyWindows,
  allUsageWindows,
  extraUsageCreditBalance,
  spendCreditBalance,
  creditBalances,
};
