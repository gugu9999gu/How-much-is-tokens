const crypto = require("crypto");
const path = require("path");
const { home, appData } = require("./paths");

const MULTI_ACCOUNT_PROVIDERS = new Set(["codex", "claude", "grok", "cursor", "copilot"]);
const MAX_LABEL_LENGTH = 48;

function providerId(value) {
  const id = String(value || "").trim().toLowerCase();
  return MULTI_ACCOUNT_PROVIDERS.has(id) ? id : null;
}

function cleanLabel(value, fallback) {
  const label = String(value || "")
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  return label || fallback;
}

function expandHome(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "~") return home();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(home(), raw.slice(2));
  return raw;
}

function isAbsoluteLike(value) {
  if (path.isAbsolute(value)) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\[^\\]+\\[^\\]+/.test(value)) return true;
  return false;
}

function canonicalConfigDir(value) {
  const expanded = expandHome(value);
  if (!expanded || !isAbsoluteLike(expanded)) return null;
  if (/^[A-Za-z]:[\\/]/.test(expanded) || expanded.startsWith("\\\\")) {
    return path.win32.normalize(expanded);
  }
  return path.normalize(expanded);
}

function pathIdentity(value) {
  const normalized = canonicalConfigDir(value);
  if (!normalized) return null;
  return process.platform === "win32" || /^[A-Za-z]:\\/.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function defaultConfigDir(id) {
  const normalized = providerId(id);
  if (normalized === "codex") return canonicalConfigDir(process.env.CODEX_HOME || path.join(home(), ".codex"));
  if (normalized === "claude") return canonicalConfigDir(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
  if (normalized === "grok") return canonicalConfigDir(process.env.GROK_HOME || path.join(home(), ".grok"));
  if (normalized === "cursor") return canonicalConfigDir(process.env.CURSOR_CONFIG_DIR || path.join(home(), ".cursor"));
  if (normalized === "copilot") {
    const fallback = process.platform === "win32"
      ? path.join(appData(), "GitHub CLI")
      : path.join(home(), ".config", "gh");
    return canonicalConfigDir(process.env.GH_CONFIG_DIR || fallback);
  }
  return null;
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

function stableProfileId(id, configDir) {
  const normalized = providerId(id);
  const identity = pathIdentity(configDir);
  if (!normalized || !identity) return null;
  return crypto
    .createHash("sha256")
    .update(`${normalized}\0${identity}`, "utf8")
    .digest("hex")
    .slice(0, 12);
}

function normalizeAccountProfiles(rawProfiles) {
  if (!Array.isArray(rawProfiles)) return [];
  const rows = [];
  const seen = new Set();

  for (const raw of rawProfiles) {
    if (!raw || typeof raw !== "object") continue;
    const id = providerId(raw.providerId || raw.provider || raw.idProvider);
    const configDir = canonicalConfigDir(raw.configDir || raw.path || raw.home);
    if (!id || !configDir) continue;
    const identity = `${id}\0${pathIdentity(configDir)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const profileId = stableProfileId(id, configDir);
    const fallback = `${id.toUpperCase()} ${rows.filter((row) => row.providerId === id).length + 1}`;
    const profile = {
      id: profileId,
      providerId: id,
      label: cleanLabel(raw.label, fallback),
      configDir,
      enabled: raw.enabled !== false,
    };
    const accountId = cleanAccountId(raw.accountId);
    if (accountId) profile.accountId = accountId;
    if (profile.enabled === false) {
      const disabledAt = cleanDisabledAt(raw.disabledAt);
      if (disabledAt) profile.disabledAt = disabledAt;
    }
    rows.push(profile);
  }
  return rows;
}

function profileToResume(rawProfiles, provider) {
  const id = providerId(provider);
  if (!id) return null;
  const disabled = normalizeAccountProfiles(rawProfiles)
    .filter((profile) => profile.providerId === id && profile.enabled === false);
  disabled.sort((a, b) => (b.disabledAt || 0) - (a.disabledAt || 0) || String(a.id).localeCompare(String(b.id)));
  return disabled[0] || null;
}

function reviveManagedProfile(rawProfiles, profileId) {
  const target = String(profileId || "");
  return normalizeAccountProfiles(rawProfiles).map((profile) => {
    if (profile.id !== target) return profile;
    const next = { ...profile, enabled: true };
    delete next.disabledAt;
    return next;
  });
}

function disableManagedProfile(rawProfiles, provider, profileId, now = Date.now()) {
  const id = providerId(provider);
  const target = String(profileId || "");
  if (!id || !target) return null;
  let found = false;
  const profiles = normalizeAccountProfiles(rawProfiles).map((profile) => {
    if (profile.providerId !== id || profile.id !== target) return profile;
    found = true;
    return { ...profile, enabled: false, disabledAt: cleanDisabledAt(now) || Date.now() };
  });
  return found ? profiles : null;
}

function mergeAccountProfiles(currentRaw, incomingRaw) {
  const current = normalizeAccountProfiles(currentRaw);
  const incoming = normalizeAccountProfiles(incomingRaw);
  const currentByDir = new Map(current.map((profile) => [pathIdentity(profile.configDir), profile]));
  const merged = incoming.map((profile) => {
    const previous = currentByDir.get(pathIdentity(profile.configDir));
    if (!previous) return profile;
    const next = { ...profile };
    if (!next.accountId && previous.accountId) next.accountId = previous.accountId;
    if (next.enabled === false && !next.disabledAt && previous.disabledAt) next.disabledAt = previous.disabledAt;
    return next;
  });
  const seen = new Set(merged.map((profile) => pathIdentity(profile.configDir)));
  for (const profile of current) {
    if (profile.enabled === false && !seen.has(pathIdentity(profile.configDir))) merged.push(profile);
  }
  return normalizeAccountProfiles(merged);
}

function rememberManagedAccountIdentities(rawProfiles, rows) {
  const profiles = normalizeAccountProfiles(rawProfiles);
  let changed = false;
  const next = profiles.map((profile) => {
    const row = (Array.isArray(rows) ? rows : []).find((item) =>
      item
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

function activeAccountProfiles(settings = {}) {
  return normalizeAccountProfiles(settings.accountProfiles).filter((profile) => {
    if (!profile.enabled) return false;
    const defaultDir = defaultConfigDir(profile.providerId);
    if (!defaultDir) return true;
    return pathIdentity(defaultDir) !== pathIdentity(profile.configDir);
  });
}

function profilesForProvider(settings, id) {
  const normalized = providerId(id);
  if (!normalized) return [];
  return activeAccountProfiles(settings).filter((profile) => profile.providerId === normalized);
}

function profileInstanceKey(profile) {
  if (!profile || !profile.providerId || !profile.id) return null;
  return `${profile.providerId}:profile:${profile.id}`;
}

function profileEnvironment(profile) {
  if (!profile || !profile.configDir) return { ...process.env };
  if (profile.providerId === "codex") return { ...process.env, CODEX_HOME: profile.configDir };
  if (profile.providerId === "claude") return { ...process.env, CLAUDE_CONFIG_DIR: profile.configDir };
  if (profile.providerId === "grok") return { ...process.env, GROK_HOME: profile.configDir };
  if (profile.providerId === "cursor" || profile.providerId === "grokbot") {
    return { ...process.env, CURSOR_CONFIG_DIR: profile.configDir };
  }
  if (profile.providerId === "copilot") {
    return {
      ...process.env,
      GH_CONFIG_DIR: profile.configDir,
      // GitHub OAuth is stored by the isolated gh profile, while Copilot's
      // own sessions/settings are kept under the same account root but in a
      // separate subdirectory. The selected token is injected only at launch.
      COPILOT_HOME: path.join(profile.configDir, "copilot-home"),
    };
  }
  return { ...process.env };
}

module.exports = {
  MULTI_ACCOUNT_PROVIDERS,
  MAX_LABEL_LENGTH,
  providerId,
  cleanLabel,
  expandHome,
  isAbsoluteLike,
  canonicalConfigDir,
  pathIdentity,
  defaultConfigDir,
  stableProfileId,
  cleanAccountId,
  normalizeAccountProfiles,
  profileToResume,
  reviveManagedProfile,
  disableManagedProfile,
  mergeAccountProfiles,
  rememberManagedAccountIdentities,
  activeAccountProfiles,
  profilesForProvider,
  profileInstanceKey,
  profileEnvironment,
};
