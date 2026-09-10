const crypto = require("crypto");

const MEDIA_PROVIDER_IDS = Object.freeze(["falai", "higgsfield", "magnific", "elevenlabs", "stability"]);
const MEDIA_PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_MEDIA_PROFILES = 40;
const MAX_MEDIA_PROFILES_PER_PROVIDER = 8;
const CONNECTION_MODES = new Set(["api", "mcp"]);

const OFFICIAL_MCP = Object.freeze({
  falai: {
    url: "https://mcp.fal.ai/mcp",
    auth: "bearer-api-key",
    balanceTools: ["balance", "get_balance", "credits", "get_credit_balance", "get_usage_stats"],
    restFallback: true,
  },
  higgsfield: {
    url: "https://mcp.higgsfield.ai/mcp",
    auth: "oauth",
    balanceTools: ["balance", "show_plans_and_credits"],
    restFallback: false,
  },
  magnific: {
    url: "https://mcp.magnific.com",
    auth: "oauth",
    balanceTools: ["balance", "credits", "get_credit_balance", "get_usage_stats"],
    restFallback: true,
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/mcp",
    auth: "oauth",
    balanceTools: ["get_subscription", "subscription", "usage", "get_usage_stats", "credits"],
    restFallback: true,
  },
});

function cleanMediaProviderId(value) {
  const id = String(value || "").trim().toLowerCase();
  return MEDIA_PROVIDER_IDS.includes(id) ? id : null;
}

function cleanMediaProfileId(value) {
  const id = String(value || "").trim().toLowerCase();
  return MEDIA_PROFILE_ID_RE.test(id) ? id : null;
}

function cleanLabel(value, fallback) {
  const label = String(value || "")
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 56);
  return label || fallback;
}

function normalizePriority(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : fallback;
}

function officialMcpFor(providerId) {
  const id = cleanMediaProviderId(providerId);
  return id && OFFICIAL_MCP[id] ? { ...OFFICIAL_MCP[id], balanceTools: [...OFFICIAL_MCP[id].balanceTools] } : null;
}

function normalizeMediaProviderProfiles(rawProfiles) {
  const out = [];
  const seen = new Set();
  const counts = new Map();
  for (const raw of Array.isArray(rawProfiles) ? rawProfiles : []) {
    if (!raw || typeof raw !== "object") continue;
    const providerId = cleanMediaProviderId(raw.providerId || raw.provider);
    const id = cleanMediaProfileId(raw.id || raw.profileId);
    if (!providerId || !id) continue;
    const key = `${providerId}:${id}`;
    if (seen.has(key)) continue;
    const count = counts.get(providerId) || 0;
    if (count >= MAX_MEDIA_PROFILES_PER_PROVIDER) continue;
    seen.add(key);
    counts.set(providerId, count + 1);
    const mode = CONNECTION_MODES.has(raw.mode) ? raw.mode : "api";
    out.push({
      id,
      providerId,
      label: cleanLabel(raw.label, `${providerId} ${count + 2}`),
      mode,
      priority: normalizePriority(raw.priority, (count + 2) * 10),
      enabled: raw.enabled !== false,
    });
    if (out.length >= MAX_MEDIA_PROFILES) break;
  }
  return out.sort((a, b) =>
    MEDIA_PROVIDER_IDS.indexOf(a.providerId) - MEDIA_PROVIDER_IDS.indexOf(b.providerId) ||
    a.priority - b.priority || a.id.localeCompare(b.id));
}

function activeMediaProviderProfiles(settings = {}, providerId = null) {
  const id = providerId ? cleanMediaProviderId(providerId) : null;
  return normalizeMediaProviderProfiles(settings.mediaProviderProfiles)
    .filter((profile) => profile.enabled !== false && (!id || profile.providerId === id));
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function nextMediaProfile(settings = {}, providerId, options = {}) {
  const id = cleanMediaProviderId(providerId);
  if (!id) return null;
  const profiles = normalizeMediaProviderProfiles(settings.mediaProviderProfiles);
  const same = profiles.filter((profile) => profile.providerId === id);
  if (same.length >= MAX_MEDIA_PROFILES_PER_PROVIDER) return null;
  const ordinal = same.length + 2;
  const base = slug(options.label) || `${id}-${ordinal}`;
  let profileId = cleanMediaProfileId(base) || `${id}-${ordinal}`;
  let suffix = 2;
  while (profiles.some((profile) => profile.providerId === id && profile.id === profileId)) {
    profileId = `${base.slice(0, 42)}-${suffix++}`;
  }
  return {
    id: profileId,
    providerId: id,
    label: cleanLabel(options.label, `${id} ${ordinal}`),
    mode: options.mode === "mcp" ? "mcp" : "api",
    priority: ordinal * 10,
    enabled: true,
  };
}

function mediaProfileInstanceKey(profile) {
  if (!profile) return null;
  const providerId = cleanMediaProviderId(profile.providerId);
  const id = cleanMediaProfileId(profile.id);
  return providerId && id ? `${providerId}:media:${id}` : null;
}

function opaqueProfileKey(profile) {
  const key = mediaProfileInstanceKey(profile);
  return key ? crypto.createHash("sha256").update(key).digest("hex").slice(0, 16) : null;
}

module.exports = {
  MEDIA_PROVIDER_IDS,
  MEDIA_PROFILE_ID_RE,
  MAX_MEDIA_PROFILES,
  MAX_MEDIA_PROFILES_PER_PROVIDER,
  OFFICIAL_MCP,
  cleanMediaProviderId,
  cleanMediaProfileId,
  normalizeMediaProviderProfiles,
  activeMediaProviderProfiles,
  nextMediaProfile,
  mediaProfileInstanceKey,
  opaqueProfileKey,
  officialMcpFor,
};
