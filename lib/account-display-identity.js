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
  const accountId = cleanIdentityValue(raw.accountId || raw.userId || raw.sub);
  const accountIdentityLabel = cleanIdentityValue(raw.accountIdentityLabel || raw.label || raw.accountName);
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
    accountId: auth.chatgpt_account_id || auth.account_id || claims.user_id || claims.userId || claims.sub,
    accountName: claims.name || profile.name,
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
    accountId: tokens.account_id || tokens.accountId,
  }, identityFromClaims(claims));
}

function identityFromClaudeAccount(account) {
  if (!account || typeof account !== "object") return normalizeAccountIdentity();
  return normalizeAccountIdentity({
    email: account.emailAddress || account.email || account.accountEmail,
    login: account.displayName || account.display_name || account.username || account.login,
    accountId: account.accountUuid || account.accountUUID || account.uuid || account.userId,
    accountName: account.fullName || account.full_name || account.displayName || account.display_name,
  });
}

function identityFromClaudeClaims(claims) {
  if (!claims || typeof claims !== "object") return normalizeAccountIdentity();
  const act = claims.act && typeof claims.act === "object" ? claims.act : {};
  const actSub = typeof act.sub === "string" ? act.sub.replace(/^user:/, "") : "";
  return normalizeAccountIdentity({
    email: act.email || claims.account_email || claims.email,
    login: act.preferred_username || claims.preferred_username,
    accountId: claims.account_uuid || claims.accountUuid || claims["ccr:account_id"] || actSub,
  });
}

function claudeOauthAccountFiles(dir) {
  const files = [];
  if (dir) files.push(path.join(dir, ".claude.json"));
  const defaultDir = path.join(home(), ".claude");
  if (dir && path.resolve(dir) === path.resolve(defaultDir)) files.push(path.join(home(), ".claude.json"));
  return files;
}

function readClaudeOauthAccount(dir) {
  for (const file of claudeOauthAccountFiles(dir)) {
    const data = readJson(file);
    const account = data && data.oauthAccount;
    if (!account || typeof account !== "object") continue;
    const identity = identityFromClaudeAccount(account);
    if (identity.accountEmail || identity.accountId || identity.accountLogin) return account;
  }
  return null;
}

function claudeIdentity(profile = null) {
  const dir = profile && profile.configDir
    ? profile.configDir
    : (process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"));
  const file = readJson(path.join(dir, ".credentials.json"));
  const oauth = file && file.claudeAiOauth;
  const fromOauth = !oauth || typeof oauth !== "object"
    ? normalizeAccountIdentity()
    : normalizeAccountIdentity({
      email: oauth.email || oauth.emailAddress || oauth.accountEmail || oauth.userEmail,
      login: oauth.login || oauth.username || oauth.userName,
      accountId: oauth.accountUuid || oauth.accountUUID || oauth.userId,
    });
  const claims = oauth && typeof oauth === "object"
    ? decodeJwtPayload(oauth.idToken || oauth.id_token || oauth.accessToken)
    : null;
  return mergeAccountIdentity(
    fromOauth,
    identityFromClaudeAccount(readClaudeOauthAccount(dir)),
    identityFromClaudeClaims(claims),
  );
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
      accountId: value.user_id || value.userId || value.account_id,
    }, identityFromClaims(decodeJwtPayload(token)));
  }
  return normalizeAccountIdentity();
}

function cursorIdentity(settings = {}, profile = null) {
  try {
    const { getCursorAuth } = require("./providers/cursor-auth");
    const auth = getCursorAuth(settings || {}, profile);
    if (!auth) return normalizeAccountIdentity();
    return mergeAccountIdentity({
      email: auth.email,
      login: auth.displayName,
      accountId: auth.userId,
    }, identityFromClaims(decodeJwtPayload(auth.token)));
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
      accountId: account.id,
      accountName: account.label,
    });
  } catch {
    return normalizeAccountIdentity();
  }
}

function profileDirectoryAccountId(profile, providerId = null) {
  const id = String((profile && profile.providerId) || providerId || "").toLowerCase();
  const target = profile && profile.configDir ? profile : null;
  if (!id) return null;
  let identity = null;
  try {
    if (id === "claude") identity = claudeIdentity(target);
    else if (id === "codex") identity = codexIdentity(target);
    else if (id === "grok") identity = grokIdentity(target);
    else if (id === "cursor") identity = cursorIdentity({}, target);
    else return null;
  } catch {
    return null;
  }
  const accountId = identity && identity.accountId ? String(identity.accountId).trim() : "";
  return accountId || null;
}

function resolveLocalAccountIdentity(providerId, settings = {}, profile = null, result = {}) {
  const id = String(providerId || "").toLowerCase();
  let local = normalizeAccountIdentity();
  if (id === "codex") local = codexIdentity(profile);
  else if (id === "claude") local = claudeIdentity(profile);
  else if (id === "grok") local = grokIdentity(profile);
  else if (id === "cursor" || id === "grokbot") local = cursorIdentity(settings, profile);
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
  identityFromClaudeAccount,
  identityFromClaudeClaims,
  claudeOauthAccountFiles,
  readClaudeOauthAccount,
  profileDirectoryAccountId,
  grokIdentity,
  cursorIdentity,
  antigravityIdentity,
  resolveLocalAccountIdentity,
  accountIdentityText,
};
