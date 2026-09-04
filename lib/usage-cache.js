const fs = require("fs");
const path = require("path");
const { appData, readJson, writeJson } = require("./paths");
const { safeCreditBalance } = require("./credit-balances");

const CACHE_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CREDIT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEGACY_GROK_PRODUCT_WINDOWS = new Set([
  "grokbuild",
  "grokcode",
  "grokchat",
  "grokappbuilder",
  "grokimagine",
]);

function usageCachePath() {
  return path.join(appData(), "how-much-is-tokens", "usage-cache.json");
}

function finiteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function hasGauge(provider) {
  if (!provider || typeof provider !== "object") return false;
  if (finiteValue(provider.remainingPct)) return true;
  if ((provider.windows || []).some((win) => finiteValue(win && win.remainingPct))) return true;
  return (provider.creditBalances || []).some((balance) => {
    const safe = safeCreditBalance(balance);
    return !!safe && (safe.unlimited || safe.balance != null || safe.used != null || safe.limit != null);
  });
}

function safeWindow(win) {
  if (!win || typeof win !== "object") return null;
  return {
    id: win.id == null ? "quota" : String(win.id),
    label: win.label == null ? "한도" : String(win.label),
    remainingPct: finiteValue(win.remainingPct) ? Number(win.remainingPct) : null,
    usedPct: finiteValue(win.usedPct) ? Number(win.usedPct) : null,
    resetAt: finiteValue(win.resetAt) ? Number(win.resetAt) : null,
    source: win.source == null ? undefined : String(win.source),
  };
}

function sanitizeProvider(provider) {
  return {
    id: String(provider.id || ""),
    instanceKey: provider.instanceKey == null ? undefined : String(provider.instanceKey),
    accountKey: provider.accountKey == null ? undefined : String(provider.accountKey),
    accountLabel: provider.accountLabel == null ? undefined : String(provider.accountLabel),
    name: String(provider.name || provider.id || ""),
    brand: provider.brand == null ? undefined : String(provider.brand),
    status: "ok",
    plan: provider.plan == null ? undefined : String(provider.plan),
    remainingPct: finiteValue(provider.remainingPct) ? Number(provider.remainingPct) : null,
    routingRemainingPct: finiteValue(provider.routingRemainingPct) ? Number(provider.routingRemainingPct) : null,
    usedPct: finiteValue(provider.usedPct) ? Number(provider.usedPct) : null,
    resetAt: finiteValue(provider.resetAt) ? Number(provider.resetAt) : null,
    limitReached: provider.limitReached === true,
    cacheMaxAgeMs: finiteValue(provider.cacheMaxAgeMs) ? Number(provider.cacheMaxAgeMs) : undefined,
    maxExtras: finiteValue(provider.maxExtras) ? Number(provider.maxExtras) : undefined,
    windows: (provider.windows || []).map(safeWindow).filter(Boolean),
    creditBalances: (provider.creditBalances || []).map(safeCreditBalance).filter(Boolean),
  };
}

function providerCacheKey(providerOrId) {
  if (providerOrId && typeof providerOrId === "object") {
    if (providerOrId.instanceKey) return String(providerOrId.instanceKey);
    if (providerOrId.accountKey) return String(providerOrId.accountKey);
    return String(providerOrId.id || "");
  }
  return String(providerOrId || "");
}

function readStore(filePath = usageCachePath()) {
  const data = readJson(filePath);
  if (!data || data.version !== CACHE_VERSION || !data.providers || typeof data.providers !== "object") {
    return { version: CACHE_VERSION, providers: {} };
  }
  return data;
}

function writeStore(store, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, store);
}

function saveProviderSnapshot(provider, now = Date.now(), filePath = usageCachePath()) {
  if (!provider || provider.status !== "ok" || !provider.id || !hasGauge(provider)) return false;
  const cacheKey = providerCacheKey(provider);
  if (!cacheKey) return false;
  const store = readStore(filePath);
  store.providers[cacheKey] = {
    savedAt: now,
    provider: sanitizeProvider(provider),
  };
  // v1.0.20 and earlier keyed the default account only by provider.id. Once a
  // real default-account key is available, remove that ambiguous legacy slot.
  // Explicit profiles never touch the default legacy slot.
  if (!provider.instanceKey && provider.accountKey && cacheKey !== provider.id) delete store.providers[provider.id];
  writeStore(store, filePath);
  return true;
}

function markRouteUnavailable(live, now = Date.now(), filePath = usageCachePath()) {
  if (!live || !live.id || !["login", "error"].includes(live.status)) return false;
  const store = readStore(filePath);
  const resolved = resolveEntry(store, live);
  if (!resolved || !resolved.entry) return false;
  resolved.entry.routeBlockedAt = now;
  resolved.entry.lastLiveStatus = live.status;
  writeStore(store, filePath);
  return true;
}

function validCachedWindows(windows, now) {
  return (windows || []).filter((win) => {
    if (!finiteValue(win && win.remainingPct)) return false;
    if (!win.resetAt) return true;
    return Number(win.resetAt) > now;
  });
}

function validCachedCredits(creditBalances, now, ageMs, providerMaxAge) {
  const maxAge = Math.min(CREDIT_MAX_AGE_MS, providerMaxAge);
  if (ageMs > maxAge) return [];
  return (creditBalances || []).filter((balance) => {
    const safe = safeCreditBalance(balance);
    if (!safe) return false;
    if (!safe.resetAt) return true;
    return Number(safe.resetAt) > now;
  });
}

function removeLegacyGrokProductWindows(id, windows) {
  if (String(id).toLowerCase() !== "grok") return windows;
  return (windows || []).filter((win) => {
    const normalizedId = String((win && win.id) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return !LEGACY_GROK_PRODUCT_WINDOWS.has(normalizedId);
  });
}

function resolveEntry(store, providerOrId) {
  const key = providerCacheKey(providerOrId);
  if (key && store.providers[key]) return { key, entry: store.providers[key] };
  // Explicit profiles must never inherit a provider-wide legacy snapshot.
  if (providerOrId && typeof providerOrId === "object" && providerOrId.instanceKey) return null;
  // One-time compatibility for pre-account-key snapshots. Only use it for the
  // default account when no account-scoped snapshot exists yet.
  if (providerOrId && typeof providerOrId === "object" && providerOrId.id) {
    const legacyKey = String(providerOrId.id);
    if (store.providers[legacyKey]) return { key: legacyKey, entry: store.providers[legacyKey] };
  }
  return null;
}

function loadProviderSnapshot(providerOrId, now = Date.now(), filePath = usageCachePath()) {
  const resolved = resolveEntry(readStore(filePath), providerOrId);
  if (!resolved) return null;
  const { entry } = resolved;
  if (!entry || !entry.provider || !finiteValue(entry.savedAt)) return null;
  const ageMs = Math.max(0, now - Number(entry.savedAt));
  const providerMaxAge = finiteValue(entry.provider.cacheMaxAgeMs)
    ? Math.max(0, Math.min(SNAPSHOT_MAX_AGE_MS, Number(entry.provider.cacheMaxAgeMs)))
    : SNAPSHOT_MAX_AGE_MS;
  if (ageMs > providerMaxAge) return null;

  const cached = sanitizeProvider(entry.provider);
  const originalWindows = removeLegacyGrokProductWindows(cached.id, cached.windows || []);
  const windows = validCachedWindows(originalWindows, now);
  const credits = validCachedCredits(cached.creditBalances, now, ageMs, providerMaxAge);

  if (originalWindows.length > 0) {
    if (windows.length === 0 && credits.length === 0) return null;
    if (windows.length > 0) {
      const primary = windows[0];
      cached.windows = windows;
      cached.remainingPct = primary.remainingPct;
      cached.usedPct = primary.usedPct;
      cached.resetAt = primary.resetAt;
    } else {
      cached.windows = [];
      cached.remainingPct = null;
      cached.usedPct = null;
      cached.resetAt = null;
    }
  } else {
    if (cached.resetAt && cached.resetAt <= now && credits.length === 0) return null;
    if (!cached.resetAt && ageMs > Math.min(SUMMARY_MAX_AGE_MS, providerMaxAge) && credits.length === 0) return null;
  }
  cached.creditBalances = credits;

  return { ...cached, cachedAt: Number(entry.savedAt), staleAgeMs: ageMs };
}

function fallbackReason(live) {
  if (live && live.status === "login") return "인증 갱신 대기";
  return "사용량 조회 재시도 중";
}

function applyUsageFallback(live, now = Date.now(), filePath = usageCachePath()) {
  if (!live || !live.id) return live;

  if (live.status === "ok") {
    saveProviderSnapshot(live, now, filePath);
    return live;
  }

  // A missing credential file normally means an intentional logout or that
  // the service was never configured, so do not resurrect an old account.
  if (live.status !== "login" && live.status !== "error") return live;

  // Keep the last-good quota for display, but persist a separate route block so
  // standalone terminal launchers cannot mistake it for a currently healthy
  // account. The next successful snapshot replaces the entry and clears it.
  markRouteUnavailable(live, now, filePath);

  const cached = loadProviderSnapshot(live, now, filePath);
  if (!cached) return live;
  const reason = fallbackReason(live);
  return {
    ...cached,
    status: "ok",
    stale: true,
    staleReason: reason,
    liveStatus: live.status,
    error: live.error || null,
    hint: live.hint || null,
    extras: [{ label: "상태", value: reason }],
  };
}

module.exports = {
  CACHE_VERSION,
  SNAPSHOT_MAX_AGE_MS,
  SUMMARY_MAX_AGE_MS,
  CREDIT_MAX_AGE_MS,
  usageCachePath,
  finiteValue,
  hasGauge,
  safeWindow,
  sanitizeProvider,
  providerCacheKey,
  readStore,
  saveProviderSnapshot,
  markRouteUnavailable,
  loadProviderSnapshot,
  applyUsageFallback,
  removeLegacyGrokProductWindows,
};
