const { requestJson, num } = require("../http");
const { stableAccountKey } = require("../account-identity");
const { remainingPercent } = require("../credit-balances");
const { cleanProfileId } = require("../openrouter-profiles");

const ID = "openrouter";
const NAME = "OpenRouter";
const BRAND = "#7c83ff";
const KEY_URL = "https://openrouter.ai/api/v1/key";
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

function clampPct(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

function money(value) {
  const n = num(value);
  if (n == null) return null;
  return `$${n.toFixed(2)}`;
}

function limitLabel(reset) {
  const normalized = String(reset || "").toLowerCase();
  if (normalized === "daily") return "API Key 일일 한도";
  if (normalized === "weekly") return "API Key 주간 한도";
  if (normalized === "monthly") return "API Key 월간 한도";
  return "API Key 한도";
}

function parseKeyPayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : (payload || {});
  const usage = num(data.usage);
  const usageDaily = num(data.usage_daily);
  const usageWeekly = num(data.usage_weekly);
  const usageMonthly = num(data.usage_monthly);
  const limit = num(data.limit);
  let limitRemaining = num(data.limit_remaining);
  if (limitRemaining == null && limit != null && usage != null) limitRemaining = Math.max(0, limit - usage);

  let window = null;
  if (limit != null && limit > 0 && limitRemaining != null) {
    const remainingPct = clampPct((Math.max(0, limitRemaining) / limit) * 100);
    window = {
      id: "api-key-limit",
      label: limitLabel(data.limit_reset),
      remainingPct,
      usedPct: remainingPct == null ? null : 100 - remainingPct,
      resetAt: null,
      source: "openrouter-key",
    };
  }

  return {
    window,
    usage,
    usageDaily,
    usageWeekly,
    usageMonthly,
    limit,
    limitRemaining,
    limitReset: data.limit_reset || null,
    label: data.label || null,
    creatorUserId: data.creator_user_id || null,
    isFreeTier: data.is_free_tier === true,
    includeByokInLimit: data.include_byok_in_limit === true,
  };
}

function parseCreditsPayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : (payload || {});
  const totalCredits = num(data.total_credits);
  const totalUsage = num(data.total_usage);
  if (totalCredits == null && totalUsage == null) return null;

  const purchased = Math.max(0, totalCredits || 0);
  const used = Math.max(0, totalUsage || 0);
  const remaining = Math.max(0, purchased - used);
  const remainingPct = purchased > 0 ? clampPct((remaining / purchased) * 100) : 0;

  return {
    window: {
      id: "account-credits",
      label: "계정 크레딧",
      remainingPct,
      usedPct: remainingPct == null ? null : 100 - remainingPct,
      resetAt: null,
      source: "openrouter-credits",
    },
    totalCredits: purchased,
    totalUsage: used,
    remaining,
  };
}

function authHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

function errorText(res, kind) {
  if (!res) return `${kind} 없음`;
  if (res.status === 401) return `${kind} 인증 오류`;
  if (res.status === 403) return `${kind} 권한 없음`;
  if (res.status === 429) return `${kind} 요청 제한`;
  return res.error || (res.status ? `${kind} HTTP ${res.status}` : `${kind} 조회 오류`);
}

function secureStoredKeys(profileId = "default") {
  try {
    return require("../secure-secrets").loadOpenRouterProfileSecrets(profileId);
  } catch {
    return {};
  }
}

function resolveKeys(secrets = {}, profile = null) {
  const profileId = cleanProfileId(profile && profile.id) || "default";
  if (profile) {
    const stored = secureStoredKeys(profileId);
    return {
      apiKey: typeof stored.apiKey === "string" ? stored.apiKey.trim() : "",
      managementKey: typeof stored.managementKey === "string" ? stored.managementKey.trim() : "",
    };
  }

  let openrouter = secrets.openrouter || {};
  let apiKey = typeof openrouter.apiKey === "string" ? openrouter.apiKey.trim() : "";
  let managementKey = typeof openrouter.managementKey === "string" ? openrouter.managementKey.trim() : "";
  if (!apiKey && !managementKey) {
    openrouter = secureStoredKeys(profileId);
    apiKey = typeof openrouter.apiKey === "string" ? openrouter.apiKey.trim() : "";
    managementKey = typeof openrouter.managementKey === "string" ? openrouter.managementKey.trim() : "";
  }
  return { apiKey, managementKey };
}

function openRouterCreditBalances(keyInfo, creditInfo) {
  const balances = [];
  if (creditInfo) {
    balances.push({
      id: "account-credits",
      label: "계정 크레딧",
      balance: creditInfo.remaining,
      used: creditInfo.totalUsage,
      limit: creditInfo.totalCredits,
      currency: "USD",
      remainingPct: remainingPercent(creditInfo.remaining, creditInfo.totalCredits),
      resetAt: null,
      source: "openrouter-credits",
    });
  }
  if (keyInfo && keyInfo.limit != null) {
    const balance = keyInfo.limitRemaining == null ? null : Math.max(0, keyInfo.limitRemaining);
    balances.push({
      id: "api-key-limit",
      label: limitLabel(keyInfo.limitReset),
      balance,
      used: balance == null ? null : Math.max(0, keyInfo.limit - balance),
      limit: Math.max(0, keyInfo.limit),
      currency: "USD",
      remainingPct: remainingPercent(balance, keyInfo.limit),
      resetAt: null,
      source: "openrouter-key",
    });
  }
  return balances;
}

async function fetchUsage(settings = {}, secrets = {}, profile = null) {
  const profileId = cleanProfileId(profile && profile.id) || null;
  if (settings.openRouterEnabled !== true) {
    return {
      id: ID,
      profileId,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "설정 > API 공급자에서 OpenRouter를 활성화하세요.",
    };
  }

  const { apiKey, managementKey } = resolveKeys(secrets, profile);
  if (!apiKey && !managementKey) {
    return {
      id: ID,
      profileId,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: profile
        ? `${profile.label || profile.id} 프로필에 API Key 또는 Management Key를 저장하세요.`
        : "설정에서 OpenRouter API Key 또는 Management Key를 저장하세요.",
    };
  }

  const fallbackAccountKey = stableAccountKey(ID, managementKey || apiKey);
  const [keyRes, creditsRes] = await Promise.all([
    apiKey ? requestJson(KEY_URL, { headers: authHeaders(apiKey) }) : Promise.resolve(null),
    managementKey ? requestJson(CREDITS_URL, { headers: authHeaders(managementKey) }) : Promise.resolve(null),
  ]);

  const keyInfo = keyRes && keyRes.ok && keyRes.json ? parseKeyPayload(keyRes.json) : null;
  const creditInfo = creditsRes && creditsRes.ok && creditsRes.json ? parseCreditsPayload(creditsRes.json) : null;
  // OAuth can mint a different API key each time for the same OpenRouter user.
  // The official current-key endpoint exposes creator_user_id, which is the
  // stable account identity we use for display/deduplication when available.
  const accountKey = keyInfo && keyInfo.creatorUserId
    ? stableAccountKey(ID, keyInfo.creatorUserId)
    : fallbackAccountKey;

  if (!keyInfo && !creditInfo) {
    const authFailure = [keyRes, creditsRes].some((res) => res && (res.status === 401 || res.status === 403));
    return {
      id: ID,
      profileId,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: authFailure ? "login" : "error",
      error: [
        apiKey && errorText(keyRes, "API Key"),
        managementKey && errorText(creditsRes, "Management Key"),
      ].filter(Boolean).join(" · "),
      hint: authFailure
        ? "OpenRouter 키 권한 또는 만료 상태를 확인하세요. 크레딧 조회에는 Management Key가 필요합니다."
        : "OpenRouter API에 연결하지 못했습니다.",
    };
  }

  const windows = [];
  if (creditInfo && creditInfo.window) windows.push(creditInfo.window);
  if (keyInfo && keyInfo.window) windows.push(keyInfo.window);

  const extras = [];
  if (keyInfo && keyInfo.usage != null) extras.push({ label: "Key 누적", value: money(keyInfo.usage) });
  if (keyInfo && keyInfo.usageMonthly != null) extras.push({ label: "이번 달", value: money(keyInfo.usageMonthly) });
  if (keyInfo && keyInfo.usageDaily != null) extras.push({ label: "오늘", value: money(keyInfo.usageDaily) });
  if (keyInfo && keyInfo.usageWeekly != null) extras.push({ label: "이번 주", value: money(keyInfo.usageWeekly) });
  if (apiKey && !keyInfo) extras.push({ label: "API Key", value: errorText(keyRes, "조회") });
  if (managementKey && !creditInfo) extras.push({ label: "Management", value: errorText(creditsRes, "조회") });

  const primary = windows[0] || null;
  return {
    id: ID,
    profileId,
    accountKey,
    accountId: keyInfo && keyInfo.creatorUserId ? keyInfo.creatorUserId : null,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: keyInfo && keyInfo.isFreeTier ? "Free" : undefined,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    creditBalances: openRouterCreditBalances(keyInfo, creditInfo),
    extras,
    maxExtras: 6,
    cacheMaxAgeMs: CACHE_MAX_AGE_MS,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  parseKeyPayload,
  parseCreditsPayload,
  limitLabel,
  money,
  resolveKeys,
  openRouterCreditBalances,
};
