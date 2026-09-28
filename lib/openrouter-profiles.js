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

function cleanAccountId(value) {
  if (value == null) return null;
  const text = String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : null;
}

function cleanDisabledAt(value) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? Math.round(time) : null;
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
    const profile = {
      id,
      providerId: "openrouter",
      label: cleanLabel(raw.label, id === "default" ? "기본 키" : `OpenRouter ${result.length + 1}`),
      priority: normalizePriority(raw.priority, (result.length + 1) * 10),
      enabled: raw.enabled !== false,
    };
    const accountId = cleanAccountId(raw.accountId);
    if (accountId) profile.accountId = accountId;
    if (profile.enabled === false) {
      const disabledAt = cleanDisabledAt(raw.disabledAt);
      if (disabledAt) profile.disabledAt = disabledAt;
    }
    result.push(profile);
    if (result.length >= MAX_PROFILES) break;
  }

  return result.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function activeOpenRouterProfiles(settings = {}) {
  return normalizeOpenRouterProfiles(settings.openRouterProfiles).filter((profile) => profile.enabled);
}

function latestDisabledOpenRouterProfile(rawProfiles) {
  const disabled = normalizeOpenRouterProfiles(rawProfiles)
    .filter((profile) => profile.enabled === false);
  disabled.sort((a, b) => (b.disabledAt || 0) - (a.disabledAt || 0) || a.id.localeCompare(b.id));
  return disabled[0] || null;
}

function selectOpenRouterLoginProfile(rawProfiles, options = {}) {
  const profiles = normalizeOpenRouterProfiles(rawProfiles);
  const createNew = options.createNew === true;
  const requested = cleanProfileId(options.profileId);
  if (!createNew) {
    if (requested) {
      const match = profiles.find((profile) => profile.id === requested);
      if (match) return { profile: match, profiles, isNew: false };
    }
    const enabled = profiles.filter((profile) => profile.enabled !== false);
    if (enabled.length) return { profile: enabled[0], profiles, isNew: false };
    const resume = latestDisabledOpenRouterProfile(profiles);
    if (resume) return { profile: resume, profiles, isNew: false, resumed: true };
  } else {
    const resume = latestDisabledOpenRouterProfile(profiles);
    if (resume) return { profile: resume, profiles, isNew: false, resumed: true };
  }
  return { profile: null, profiles, isNew: true };
}

function mergeOpenRouterProfiles(currentRaw, incomingRaw) {
  const current = normalizeOpenRouterProfiles(currentRaw);
  const incoming = normalizeOpenRouterProfiles(incomingRaw);
  const byId = new Map(current.map((profile) => [profile.id, profile]));
  return normalizeOpenRouterProfiles(incoming.map((profile) => {
    const previous = byId.get(profile.id);
    if (!previous) return profile;
    const next = { ...profile };
    if (!next.accountId && previous.accountId) next.accountId = previous.accountId;
    if (next.enabled === false && !next.disabledAt && previous.disabledAt) next.disabledAt = previous.disabledAt;
    return next;
  }));
}

function rememberOpenRouterAccountIds(rawProfiles, rows) {
  const profiles = normalizeOpenRouterProfiles(rawProfiles);
  let changed = false;
  const next = profiles.map((profile) => {
    const row = (Array.isArray(rows) ? rows : []).find((item) =>
      item
      && String(item.providerId || item.id || "").toLowerCase().split(":")[0] === "openrouter"
      && item.profileId === profile.id
      && item.status === "ok"
      && item.stale !== true
      && cleanAccountId(item.accountId));
    const accountId = row ? cleanAccountId(row.accountId) : null;
    if (!accountId || profile.accountId === accountId) return profile;
    changed = true;
    return { ...profile, accountId };
  });
  return changed ? next : null;
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

function slugProfileId(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 24);
  return cleanProfileId(slug);
}

function nextOpenRouterProfileId(rawProfiles, label = "") {
  const profiles = normalizeOpenRouterProfiles(rawProfiles);
  const used = new Set(profiles.map((profile) => profile.id));
  if (!profiles.length && !used.has("default")) return "default";

  const preferred = slugProfileId(label);
  if (preferred && preferred !== "default" && !used.has(preferred)) return preferred;

  let ordinal = Math.max(2, profiles.length + 1);
  let id = `key-${ordinal}`;
  while (used.has(id)) {
    ordinal += 1;
    id = `key-${ordinal}`;
  }
  return id;
}

function nextOpenRouterPriority(rawProfiles) {
  const profiles = normalizeOpenRouterProfiles(rawProfiles);
  if (!profiles.length) return 10;
  const highest = profiles.reduce((max, profile) => Math.max(max, Number(profile.priority) || 0), 0);
  return Math.min(9999, highest + 10);
}

function createOpenRouterProfile(rawProfiles, options = {}) {
  const profiles = normalizeOpenRouterProfiles(rawProfiles);
  if (profiles.length >= MAX_PROFILES) return null;
  const ordinal = profiles.length + 1;
  const id = nextOpenRouterProfileId(profiles, options.label);
  return {
    id,
    providerId: "openrouter",
    label: cleanLabel(options.label, ordinal === 1 ? "기본 키" : `OpenRouter ${ordinal}`),
    priority: normalizePriority(options.priority, nextOpenRouterPriority(profiles)),
    enabled: options.enabled !== false,
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
  selectOpenRouterLoginProfile,
  mergeOpenRouterProfiles,
  rememberOpenRouterAccountIds,
  normalizeOpenRouterRouter,
  defaultOpenRouterProfile,
  slugProfileId,
  nextOpenRouterProfileId,
  nextOpenRouterPriority,
  createOpenRouterProfile,
};
