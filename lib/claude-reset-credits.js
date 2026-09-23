const { requestJson } = require("./http");
const { parseTime } = require("./time");
const { billingCycle } = require("./billing-cycle");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const FACT_CACHE_MS = 3 * 60 * 1000;

const factCache = new Map();

function claudeHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
    Accept: "application/json",
  };
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function ticketFromGrant(grant, now) {
  if (!grant || typeof grant !== "object") return null;
  const remainingCount = finiteCount(grant.resets_left ?? grant.remainingCount);
  if (remainingCount == null || remainingCount <= 0) return null;
  const expiresAt = parseTime(grant.ends_at || grant.expiresAt || grant.expires_at);
  if (expiresAt != null && expiresAt <= now) return null;
  const title = typeof grant.label === "string" && grant.label.trim()
    ? grant.label.trim()
    : "리셋 쿠폰";
  return { title, expiresAt, remainingCount };
}

function couponsFromCedar(block, now = Date.now()) {
  if (!block || typeof block !== "object") return null;
  const grants = Array.isArray(block.grants) ? block.grants : [];
  const tickets = grants.map((grant) => ticketFromGrant(grant, now)).filter(Boolean);
  const availableCount = tickets.reduce((sum, ticket) => sum + ticket.remainingCount, 0);
  if (availableCount > 0) {
    return {
      visibility: "known",
      availableCount,
      tickets: tickets.slice(0, 3),
      source: "claude-cedar",
    };
  }
  if (block.ineligible_reason === "surface") {
    return { visibility: "web-only", availableCount: null, tickets: [], source: "claude-cedar" };
  }
  if (block.eligible === true || block.eligible === false || Array.isArray(block.grants)) {
    return { visibility: "known", availableCount: 0, tickets: [], source: "claude-cedar" };
  }
  return null;
}

function couponsFromJuniper(block, now = Date.now()) {
  if (!block || typeof block !== "object") return null;
  if (block.ineligible_reason === "surface") {
    return { visibility: "web-only", availableCount: null, tickets: [], source: "claude-juniper" };
  }
  const expiresAt = parseTime(block.weekly_resets_at || block.expires_at);
  const expired = expiresAt != null && expiresAt <= now;
  const usable = block.eligible === true && block.arm === "reset" && block.available === true && !expired;
  if (block.eligible == null && block.available == null && block.arm == null) return null;
  return {
    visibility: "known",
    availableCount: usable ? 1 : 0,
    tickets: usable ? [{ title: "세션 리셋", expiresAt, remainingCount: 1 }] : [],
    source: "claude-juniper",
  };
}

function couponsFromUsagePayload(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  return combineResetCoupons([
    couponsFromCedar(payload.cedar_ember, now),
    couponsFromJuniper(payload.juniper_tide, now),
  ]);
}

function combineResetCoupons(parts) {
  const known = (Array.isArray(parts) ? parts : []).filter(Boolean);
  if (!known.length) {
    return { visibility: "unknown", availableCount: null, tickets: [], source: "claude-oauth-usage" };
  }
  const positive = known.filter((part) => part.visibility === "known" && Number(part.availableCount) > 0);
  if (positive.length) {
    const tickets = positive.flatMap((part) => part.tickets || []).slice(0, 3);
    return {
      visibility: "known",
      availableCount: positive.reduce((sum, part) => sum + Number(part.availableCount), 0),
      tickets,
      source: "claude-oauth-usage",
    };
  }
  if (known.some((part) => part.visibility === "web-only")) {
    return { visibility: "web-only", availableCount: null, tickets: [], source: "claude-oauth-usage" };
  }
  if (known.every((part) => part.visibility === "known")) {
    return { visibility: "known", availableCount: 0, tickets: [], source: "claude-oauth-usage" };
  }
  return { visibility: "unknown", availableCount: null, tickets: [], source: "claude-oauth-usage" };
}

function billingFromClaudeProfile(profile) {
  const org = profile && profile.organization;
  if (!org || typeof org !== "object") return null;
  const status = typeof org.subscription_status === "string" ? org.subscription_status : null;
  return billingCycle({
    startedAt: org.subscription_created_at,
    label: "구독 시작",
    status,
    note: org.subscription_created_at ? null : (status ? "다음 결제일 미제공" : null),
    source: "claude-oauth-profile",
  });
}

function cachedFacts(cacheKey, now) {
  if (!cacheKey) return null;
  const cached = factCache.get(cacheKey);
  if (!cached || now - cached.at >= FACT_CACHE_MS) return null;
  return cached.value;
}

async function readClaudeAccountFacts(accessToken, usagePayload, options = {}) {
  const now = Number(options.now) || Date.now();
  const cacheKey = options.cacheKey || null;
  if (options.force !== true) {
    const cached = cachedFacts(cacheKey, now);
    if (cached) return cached;
  }

  const request = options.requestJson || requestJson;
  const headers = claudeHeaders(accessToken);
  let payload = usagePayload && typeof usagePayload === "object" ? usagePayload : null;
  const inline = couponsFromUsagePayload(payload, now);
  let coupons = inline && inline.visibility !== "unknown" ? inline : null;

  if (!coupons && accessToken) {
    const [cedarResult, juniperResult] = await Promise.all([
      request(`${USAGE_URL}?cedar_ember=1&skip_spend=1`, { headers, timeoutMs: 12000 }).catch(() => null),
      request(`${USAGE_URL}?at_wall=1&skip_spend=1`, { headers, timeoutMs: 12000 }).catch(() => null),
    ]);
    const cedarPayload = cedarResult && cedarResult.ok ? cedarResult.json : null;
    const juniperPayload = juniperResult && juniperResult.ok ? juniperResult.json : null;
    coupons = combineResetCoupons([
      couponsFromCedar(cedarPayload && cedarPayload.cedar_ember, now),
      couponsFromJuniper(juniperPayload && juniperPayload.juniper_tide, now),
      couponsFromCedar(juniperPayload && juniperPayload.cedar_ember, now),
    ]);
  }

  let billing = null;
  if (accessToken) {
    try {
      const profileResult = await request(PROFILE_URL, { headers, timeoutMs: 12000 });
      if (profileResult && profileResult.ok) billing = billingFromClaudeProfile(profileResult.json);
    } catch {
      billing = null;
    }
  }

  const value = {
    resetCoupons: coupons || { visibility: "unknown", availableCount: null, tickets: [], source: "claude-oauth-usage" },
    billing,
  };
  if (cacheKey) factCache.set(cacheKey, { at: now, value });
  return value;
}

function clearClaudeFactCache() {
  factCache.clear();
}

module.exports = {
  FACT_CACHE_MS,
  couponsFromCedar,
  couponsFromJuniper,
  couponsFromUsagePayload,
  combineResetCoupons,
  billingFromClaudeProfile,
  readClaudeAccountFacts,
  clearClaudeFactCache,
};
