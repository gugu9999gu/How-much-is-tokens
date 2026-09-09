const path = require("path");
const { home, readJson, exists } = require("./paths");

const MAX_IDENTITY_LENGTH = 240;

function cleanIdentityValue(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, MAX_IDENTITY_LENGTH);
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeAccountIdentity(raw = {}) {
  const accountEmail = cleanIdentityValue(raw.accountEmail || raw.email || raw.emailAddress);
  const accountLogin = cleanIdentityValue(raw.accountLogin || raw.login || raw.username || raw.preferredUsername);
  const accountId = cleanIdentityValue(raw.accountId || raw.id || raw.userId || raw.sub);
  const accountIdentityLabel = cleanIdentityValue(raw.accountIdentityLabel || raw.label || raw.name);
  return {
    accountEmail,
    accountLogin,
    accountId,
    accountIdentityLabel,
  };
}

function mergeAccountIdentity(...sources) {
  const out = {
    accountEmail: null,
    accountLogin: null,
    accountId: null,
    accountIdentityLabel: null,
  };
  for (const source of sources) {
    const normalized = normalizeAccountIdentity(source || {});
    for (const key of Object.keys(out)) {
      if (!out[key] && normalized[key]) out[key] = normalized[key];
    }
  }
  return out;
}

function identityFromClaims(claims) {
  if (!claims || typeof claims !== "object") return normalizeAccountIdentity();
  const profile = claims["https://api.openai.com/profile"] || claims.profile || {};
  const auth = claims["https://api.openai.com/auth"] || {};
  return normalizeAccountIdentity({
    email: claims.email || profile.email,
    login: claims.preferred_username || claims.preferredUsername || claims.login || profile.username,
    id: auth.chatgpt_account_id || auth.account_id || claims.user_id || claims.userId || claims.sub,
    label: claims.name || profile.name,
  });
}

function codexIdentity(profile = null) {
  const dir = profile && profile.configDir
    ? profile.configDir
    : (process.env.CODEX_HOME || path.join(home(), ".codex"));
  const file = readJson(path.join(dir, "auth.json"));
  const tokens = file && file.tokens;
  if (!tokens || typeof tokens !== "object") return normalizeAccountIdentity();
  const claims = decodeJwtPayload(tokens.id_token || tokens.idToken || tokens.access_token);
  return mergeAccountIdentity({
    email: tokens.email || (file && file.email),
    login: tokens.login || tokens.username,
    id: tokens.account_id || tokens.accountId,
  }, identityFromClaims(claims));
}

function claudeIdentity(profile = null) {
  const dir = profile && profile.configDir
    ? profile.configDir
    : (process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
  const file = readJson(path.join(dir, ".credentials.json"));
  const oauth = file && file.claudeAiOauth;
  if (!oauth || typeof oauth !== "object") return normalizeAccountIdentity();
  const claims = decodeJwtPayload(oauth.idToken || oauth.id_token || oauth.accessToken);
  return mergeAccountIdentity({
    email: oauth.email || oauth.emailAddress || oauth.accountEmail || oauth.userEmail,
    login: oauth.login || oauth.username || oauth.userName,
    id: oauth.accountUuid || oauth.accountUUID || oauth.userId || oauth.organizationUuid,
  }, identityFromClaims(claims));
}

function rankedGrokEntries(file) {
  if (!file || typeof file !== "object") return [];
  const entries = Object.entries(file);
  return [
    ...entries.filter(([key]) => key.includes("auth.x.ai")),
    ...entries.filter(([key]) => key.includes("accounts.x.ai")),
    ...entries,
  ];
}

function grokIdentity(profile = null) {
  const dir = profile && profile.configDir
    ? profile.configDir
    : (process.env.GROK_HOME || path.join(home(), ".grok"));
  const file = readJson(path.join(dir, "auth.json"));
  const now = Date.now();
  const seen = new Set();
  for (const [key, value] of rankedGrokEntries(file)) {
    if (seen.has(key) || !value || typeof value !== "object") continue;
    seen.add(key);
    if (value.auth_mode === "web_login" || value.auth_mode === "api_key") continue;
    if (value.expires_at && Date.parse(value.expires_at) < now) continue;
    const token = value.key || value.access_token;
    if (!token) continue;
    return mergeAccountIdentity({
      email: value.email || value.user_email || value.account_email,
      login: value.login || value.username || value.handle,
      id: value.user_id || value.userId || value.account_id,
    }, identityFromClaims(decodeJwtPayload(token)));
  }
  return normalizeAccountIdentity();
}

function cursorIdentity(settings = {}) {
  try {
    const { getCursorAuth } = require("./providers/cursor-auth");
    const auth = getCursorAuth(settings || {});
    if (!auth) return normalizeAccountIdentity();
    return mergeAccountIdentity({ id: auth.userId }, identityFromClaims(decodeJwtPayload(auth.token)));
  } catch {
    return normalizeAccountIdentity();
  }
}

function antigravityIdentity() {
  try {
    const { snapshotPath } = require("./antigravity-bridge");
    const file = snapshotPath();
    if (!exists(file)) return normalizeAccountIdentity();
    const snapshot = readJson(file);
    const accounts = snapshot && Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const activeId = snapshot && snapshot.activeAccountId ? snapshot.activeAccountId : null;
    const account = accounts.find((item) => item && item.id === activeId) || accounts[0] || null;
    if (!account) return normalizeAccountIdentity();
    return normalizeAccountIdentity({
      email: account.email,
      login: account.login || account.username,
      id: account.id,
      label: account.label,
    });
  } catch {
    return normalizeAccountIdentity();
  }
}

function resolveLocalAccountIdentity(providerId, settings = {}, profile = null, result = {}) {
  const id = String(providerId || "").toLowerCase();
  let local = normalizeAccountIdentity();
  if (id === "codex") local = codexIdentity(profile);
  else if (id === "claude") local = claudeIdentity(profile);
  else if (id === "grok") local = grokIdentity(profile);
  else if (id === "cursor" || id === "grokbot") local = cursorIdentity(settings);
  else if (id === "antigravity") local = antigravityIdentity();
  return mergeAccountIdentity(result, local);
}

function accountIdentityText(identity = {}) {
  const normalized = normalizeAccountIdentity(identity);
  const parts = [];
  if (normalized.accountEmail) parts.push(normalized.accountEmail);
  if (normalized.accountLogin && normalized.accountLogin !== normalized.accountEmail) parts.push(normalized.accountLogin);
  if (normalized.accountId && !parts.includes(normalized.accountId)) parts.push(`ID ${normalized.accountId}`);
  if (!parts.length && normalized.accountIdentityLabel) parts.push(normalized.accountIdentityLabel);
  return parts.join(" · ");
}

module.exports = {
  MAX_IDENTITY_LENGTH,
  cleanIdentityValue,
  decodeJwtPayload,
  normalizeAccountIdentity,
  mergeAccountIdentity,
  identityFromClaims,
  codexIdentity,
  claudeIdentity,
  grokIdentity,
  cursorIdentity,
  antigravityIdentity,
  resolveLocalAccountIdentity,
  accountIdentityText,
};
