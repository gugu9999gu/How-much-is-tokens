const fs = require("fs");
const path = require("path");
const { appData, readJson, writeJson } = require("./paths");

const CACHE_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
  return (provider.windows || []).some((win) => finiteValue(win && win.remainingPct));
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
    name: String(provider.name || provider.id || ""),
    brand: provider.brand == null ? undefined : String(provider.brand),
    status: "ok",
    plan: provider.plan == null ? undefined : String(provider.plan),
    remainingPct: finiteValue(provider.remainingPct) ? Number(provider.remainingPct) : null,
    usedPct: finiteValue(provider.usedPct) ? Number(provider.usedPct) : null,
    resetAt: finiteValue(provider.resetAt) ? Number(provider.resetAt) : null,
    windows: (provider.windows || []).map(safeWindow).filter(Boolean),
  };
}

function readStore(filePath = usageCachePath()) {
  const data = readJson(filePath);
  if (!data || data.version !== CACHE_VERSION || !data.providers || typeof data.providers !== "object") {
    return { version: CACHE_VERSION, providers: {} };
  }
  return data;
}

function saveProviderSnapshot(provider, now = Date.now(), filePath = usageCachePath()) {
  if (!provider || provider.status !== "ok" || !provider.id || !hasGauge(provider)) return false;
  const store = readStore(filePath);
  store.providers[provider.id] = {
    savedAt: now,
    provider: sanitizeProvider(provider),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, store);
  return true;
}

function validCachedWindows(windows, now) {
  return (windows || []).filter((win) => {
    if (!finiteValue(win && win.remainingPct)) return false;
    if (!win.resetAt) return true;
    return Number(win.resetAt) > now;
  });
}

function removeLegacyGrokProductWindows(id, windows) {
  if (String(id).toLowerCase() !== "grok") return windows;
  return (windows || []).filter((win) => {
    const normalizedId = String((win && win.id) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return !LEGACY_GROK_PRODUCT_WINDOWS.has(normalizedId);
  });
}

function loadProviderSnapshot(id, now = Date.now(), filePath = usageCachePath()) {
  const entry = readStore(filePath).providers[id];
  if (!entry || !entry.provider || !finiteValue(entry.savedAt)) return null;
  const ageMs = Math.max(0, now - Number(entry.savedAt));
  if (ageMs > SNAPSHOT_MAX_AGE_MS) return null;

  const cached = sanitizeProvider(entry.provider);
  // v1.0.17 and earlier incorrectly stored Grok productUsage rows as if each
  // product had an independent remaining quota. Those rows are a breakdown of
  // one shared pool and must never be resurrected by stale-cache fallback.
  const originalWindows = removeLegacyGrokProductWindows(cached.id, cached.windows || []);
  const windows = validCachedWindows(originalWindows, now);

  if (originalWindows.length > 0) {
    // Quota values are invalid after their own reset boundary. Drop expired
    // short windows (e.g. 5h) while retaining a still-valid weekly window.
    if (windows.length === 0) return null;
    const primary = windows[0];
    cached.windows = windows;
    cached.remainingPct = primary.remainingPct;
    cached.usedPct = primary.usedPct;
    cached.resetAt = primary.resetAt;
  } else {
    if (cached.resetAt && cached.resetAt <= now) return null;
    if (!cached.resetAt && ageMs > SUMMARY_MAX_AGE_MS) return null;
  }

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

  const cached = loadProviderSnapshot(live.id, now, filePath);
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
  usageCachePath,
  finiteValue,
  hasGauge,
  sanitizeProvider,
  saveProviderSnapshot,
  loadProviderSnapshot,
  applyUsageFallback,
  removeLegacyGrokProductWindows,
};
