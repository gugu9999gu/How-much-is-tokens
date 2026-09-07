const { ipcMain, shell } = require("electron");
const {
  SUPPORTED_OAUTH_PROVIDERS,
  encryptionAvailable,
  upsertOAuthCredential,
  getOAuthCredential,
  listOAuthCredentials,
  listAllOAuthCredentialMetadata,
  setActiveOAuthCredential,
  markOAuthCredentialNeedsReauth,
  removeOAuthCredential,
  allDecryptedOAuthCredentials,
} = require("./oauth-credential-store");
const { loginProvider, refreshProviderCredential } = require("./provider-oauth-flows");

const REFRESH_SKEW_MS = 90 * 1000;
const refreshInflight = new Map();

function normalizeProviderId(value) {
  const id = String(value || "").trim().toLowerCase();
  return SUPPORTED_OAUTH_PROVIDERS.has(id) ? id : null;
}

function safeErrorMessage(error) {
  const text = String((error && error.message) || error || "OAuth 작업 실패");
  // Never surface URL query strings or token-shaped fragments through renderer IPC.
  return text
    .replace(/([?&](?:code|token|access_token|refresh_token|code_verifier|id_token)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\b(?:sk|gho|ghr|ghu|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "<redacted>")
    .slice(0, 260);
}

function isTerminalRefreshError(error) {
  const text = String((error && error.message) || error || "").toLowerCase();
  return [
    "http 400", "http 401", "http 403", "invalid_grant", "access_denied",
    "expired_token", "refresh token이 없습니다", "durable oauth grant가 없습니다",
  ].some((needle) => text.includes(needle));
}

async function refreshOne(providerId, slotId, credential) {
  const key = `${providerId}:${slotId}`;
  if (refreshInflight.has(key)) return refreshInflight.get(key);
  const promise = (async () => {
    try {
      const fresh = await refreshProviderCredential(providerId, credential);
      upsertOAuthCredential(providerId, fresh, { slotId, activate: false });
      markOAuthCredentialNeedsReauth(providerId, slotId, false);
      return { credential: fresh, needsReauth: false, refreshError: null };
    } catch (error) {
      const terminal = isTerminalRefreshError(error);
      if (terminal) markOAuthCredentialNeedsReauth(providerId, slotId, true);
      return {
        credential: terminal ? null : credential,
        needsReauth: terminal,
        refreshError: safeErrorMessage(error),
      };
    } finally {
      refreshInflight.delete(key);
    }
  })();
  refreshInflight.set(key, promise);
  return promise;
}

async function usableAccountRows(providerId) {
  const rows = allDecryptedOAuthCredentials(providerId);
  const output = [];
  for (const row of rows) {
    let credential = row.credential;
    let needsReauth = row.needsReauth === true;
    let refreshError = null;
    const expires = Number(credential && credential.expires);
    if (!needsReauth && Number.isFinite(expires) && expires <= Date.now() + REFRESH_SKEW_MS) {
      const refreshed = await refreshOne(providerId, row.slotId, credential);
      credential = refreshed.credential;
      needsReauth = refreshed.needsReauth;
      refreshError = refreshed.refreshError;
    }
    output.push({
      providerId,
      slotId: row.slotId,
      label: row.label,
      active: row.active,
      needsReauth,
      refreshError,
      credential,
    });
  }
  return output;
}

async function loadUsableOAuthSecrets() {
  const oauthAccounts = {};
  if (!encryptionAvailable()) return { oauthAccounts };
  for (const providerId of SUPPORTED_OAUTH_PROVIDERS) {
    const rows = await usableAccountRows(providerId);
    if (rows.length) oauthAccounts[providerId] = rows;
  }
  return { oauthAccounts };
}

function publicLoginResult(providerId, slotId) {
  const accounts = listOAuthCredentials(providerId);
  const account = accounts.find((row) => row.slotId === slotId) || accounts.find((row) => row.active) || null;
  return {
    ok: true,
    providerId,
    slotId: account ? account.slotId : null,
    accountLabel: account ? account.label : "계정",
    accounts,
  };
}

async function runProviderLogin(providerId, options = {}) {
  const id = normalizeProviderId(providerId);
  if (!id) return { ok: false, providerId: String(providerId || ""), reason: "unsupported-provider" };
  if (!encryptionAvailable()) {
    return { ok: false, providerId: id, reason: "secure-storage-unavailable" };
  }

  const requestedSlot = String(options.slotId || "").trim();
  const current = requestedSlot ? getOAuthCredential(id, requestedSlot) : null;
  try {
    const credential = await loginProvider(id, {
      openExternal: (url) => shell.openExternal(url),
      addAccount: options.addAccount === true,
      forceLogin: options.addAccount === true || options.reauth === true,
      previousCredential: current,
    });
    const slotId = upsertOAuthCredential(id, credential, {
      slotId: requestedSlot || null,
      activate: options.activate !== false,
    });
    markOAuthCredentialNeedsReauth(id, slotId, false);
    return publicLoginResult(id, slotId);
  } catch (error) {
    return {
      ok: false,
      providerId: id,
      reason: "oauth-login-failed",
      error: safeErrorMessage(error),
    };
  }
}

ipcMain.handle("provider-oauth-login", (_event, providerId, options) => runProviderLogin(providerId, options || {}));
ipcMain.handle("list-provider-oauth-credentials", (_event, providerId) => {
  const id = normalizeProviderId(providerId);
  return id ? listOAuthCredentials(id) : listAllOAuthCredentialMetadata();
});
ipcMain.handle("set-active-provider-oauth-credential", (_event, providerId, slotId) => {
  const id = normalizeProviderId(providerId);
  if (!id) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  return setActiveOAuthCredential(id, slotId);
});
ipcMain.handle("remove-provider-oauth-credential", (_event, providerId, slotId) => {
  const id = normalizeProviderId(providerId);
  if (!id) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  return removeOAuthCredential(id, slotId);
});

module.exports = {
  REFRESH_SKEW_MS,
  normalizeProviderId,
  safeErrorMessage,
  isTerminalRefreshError,
  refreshOne,
  usableAccountRows,
  loadUsableOAuthSecrets,
  runProviderLogin,
};