const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_LABEL_LENGTH = 48;
const MAX_PROFILES = 16;
const DEFAULT_ROUTER_PORT = 43123;
const ROUTER_POLICIES = new Set(["priority-fallback", "max-remaining"]);

function cleanProfileId(value) {
  const id = String(value || "").trim().toLowerCase();
  return PROFILE_ID_RE.test(id) ? id : null;
}

function cleanLabel(value, fallback) {
  const label = String(value || "")
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  return label || fallback;
}

function normalizePriority(value, fallback = 100) {
  const priority = Number(value);
  if (!Number.isFinite(priority)) return fallback;
  return Math.max(0, Math.min(9999, Math.round(priority)));
}

function normalizeOpenRouterProfiles(rawProfiles) {
  if (!Array.isArray(rawProfiles)) return [];
  const result = [];
  const seen = new Set();

  for (const raw of rawProfiles) {
    if (!raw || typeof raw !== "object") continue;
    const id = cleanProfileId(raw.id || raw.profileId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      providerId: "openrouter",
      label: cleanLabel(raw.label, id === "default" ? "기본 키" : `OpenRouter ${result.length + 1}`),
      priority: normalizePriority(raw.priority, (result.length + 1) * 10),
      enabled: raw.enabled !== false,
    });
    if (result.length >= MAX_PROFILES) break;
  }

  return result.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function activeOpenRouterProfiles(settings = {}) {
  return normalizeOpenRouterProfiles(settings.openRouterProfiles).filter((profile) => profile.enabled);
}

function normalizeOpenRouterRouter(raw = {}) {
  const portValue = Number(raw && raw.port);
  const port = Number.isInteger(portValue) && portValue >= 1024 && portValue <= 65535
    ? portValue
    : DEFAULT_ROUTER_PORT;
  const policy = ROUTER_POLICIES.has(raw && raw.policy) ? raw.policy : "priority-fallback";
  return {
    enabled: !!(raw && raw.enabled === true),
    port,
    policy,
  };
}

function defaultOpenRouterProfile() {
  return {
    id: "default",
    providerId: "openrouter",
    label: "기본 키",
    priority: 10,
    enabled: true,
  };
}

module.exports = {
  PROFILE_ID_RE,
  MAX_PROFILES,
  DEFAULT_ROUTER_PORT,
  ROUTER_POLICIES,
  cleanProfileId,
  cleanLabel,
  normalizePriority,
  normalizeOpenRouterProfiles,
  activeOpenRouterProfiles,
  normalizeOpenRouterRouter,
  defaultOpenRouterProfile,
};
