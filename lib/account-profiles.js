const crypto = require("crypto");
const path = require("path");
const { home } = require("./paths");

const MULTI_ACCOUNT_PROVIDERS = new Set(["codex", "claude", "grok"]);
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
  // Windows profile paths are case-insensitive in the supported desktop build.
  return process.platform === "win32" || /^[A-Za-z]:\\/.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function defaultConfigDir(id) {
  const normalized = providerId(id);
  if (normalized === "codex") return canonicalConfigDir(process.env.CODEX_HOME || path.join(home(), ".codex"));
  if (normalized === "claude") return canonicalConfigDir(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
  if (normalized === "grok") return canonicalConfigDir(process.env.GROK_HOME || path.join(home(), ".grok"));
  return null;
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
    rows.push({
      id: profileId,
      providerId: id,
      label: cleanLabel(raw.label, fallback),
      configDir,
      enabled: raw.enabled !== false,
    });
  }
  return rows;
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
  if (!profile || !profile.configDir) return process.env;
  if (profile.providerId === "codex") return { ...process.env, CODEX_HOME: profile.configDir };
  if (profile.providerId === "claude") return { ...process.env, CLAUDE_CONFIG_DIR: profile.configDir };
  if (profile.providerId === "grok") return { ...process.env, GROK_HOME: profile.configDir };
  return process.env;
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
  normalizeAccountProfiles,
  activeAccountProfiles,
  profilesForProvider,
  profileInstanceKey,
  profileEnvironment,
};
