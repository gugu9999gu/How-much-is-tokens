const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { readJson, writeJson } = require("./paths");

const STORE_VERSION = 1;
const SUPPORTED_OAUTH_PROVIDERS = new Set([
  "codex",
  "claude",
  "grok",
  "cursor",
  "copilot",
  "antigravity",
]);

function providerId(value) {
  const id = String(value || "").trim().toLowerCase();
  return SUPPORTED_OAUTH_PROVIDERS.has(id) ? id : null;
}

function credentialStorePath() {
  return path.join(app.getPath("userData"), "oauth-credentials.json");
}

function encryptionAvailable() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function emptyStore() {
  return { version: STORE_VERSION, providers: {} };
}

function readStore() {
  const data = readJson(credentialStorePath());
  if (!data || data.version !== STORE_VERSION || !data.providers || typeof data.providers !== "object") {
    return emptyStore();
  }
  return data;
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(credentialStorePath()), { recursive: true });
  writeJson(credentialStorePath(), store);
}

function encryptCredential(credential) {
  if (!encryptionAvailable()) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없어 OAuth 자격증명을 저장할 수 없습니다.");
  }
  return safeStorage.encryptString(JSON.stringify(credential)).toString("base64");
}

function decryptCredential(encoded) {
  if (!encoded || !encryptionAvailable()) return null;
  try {
    const text = safeStorage.decryptString(Buffer.from(String(encoded), "base64"));
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function providerBucket(store, id, create = false) {
  let bucket = store.providers[id];
  if (!bucket || typeof bucket !== "object") {
    if (!create) return null;
    bucket = { activeSlotId: null, accounts: {} };
    store.providers[id] = bucket;
  }
  if (!bucket.accounts || typeof bucket.accounts !== "object") bucket.accounts = {};
  return bucket;
}

function normalizedIdentity(credential) {
  const accountId = String((credential && credential.accountId) || "").trim().toLowerCase();
  const email = String((credential && credential.email) || "").trim().toLowerCase();
  return accountId ? `id:${accountId}` : email ? `email:${email}` : null;
}

function sameCredentialIdentity(a, b) {
  const left = normalizedIdentity(a);
  const right = normalizedIdentity(b);
  return !!left && left === right;
}

function maskEmail(value) {
  const email = String(value || "").trim();
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = local.length <= 2 ? `${local[0] || "*"}*` : `${local[0]}${"*".repeat(Math.min(5, local.length - 2))}${local.at(-1)}`;
  return `${maskedLocal}@${domain}`;
}

function maskAccountId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function labelForCredential(credential, ordinal) {
  return maskEmail(credential && credential.email)
    || maskAccountId(credential && credential.accountId)
    || `계정 ${ordinal}`;
}

function accountEntries(bucket) {
  if (!bucket) return [];
  return Object.entries(bucket.accounts)
    .filter(([, entry]) => entry && typeof entry === "object")
    .sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
}

function findSlotByIdentity(bucket, credential) {
  if (!bucket || !normalizedIdentity(credential)) return null;
  for (const [slotId, entry] of accountEntries(bucket)) {
    const stored = decryptCredential(entry.encrypted);
    if (stored && sameCredentialIdentity(stored, credential)) return slotId;
  }
  return null;
}

function upsertOAuthCredential(rawProviderId, credential, options = {}) {
  const id = providerId(rawProviderId);
  if (!id) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  if (!credential || typeof credential !== "object" || !String(credential.access || "").trim()) {
    throw new Error("OAuth access token이 없습니다.");
  }

  const store = readStore();
  const bucket = providerBucket(store, id, true);
  const existingIdentitySlot = findSlotByIdentity(bucket, credential);
  const requestedSlot = String(options.slotId || "").trim();
  const slotId = existingIdentitySlot
    || (requestedSlot && bucket.accounts[requestedSlot] ? requestedSlot : crypto.randomUUID());
  const now = Date.now();
  const previous = bucket.accounts[slotId] || {};
  bucket.accounts[slotId] = {
    encrypted: encryptCredential(credential),
    createdAt: Number(previous.createdAt) || now,
    updatedAt: now,
    needsReauth: false,
  };
  if (options.activate !== false || !bucket.activeSlotId) bucket.activeSlotId = slotId;
  writeStore(store);
  return slotId;
}

function getOAuthCredential(rawProviderId, slotId) {
  const id = providerId(rawProviderId);
  if (!id || !slotId) return null;
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  const entry = bucket && bucket.accounts[String(slotId)];
  return entry ? decryptCredential(entry.encrypted) : null;
}

function getActiveOAuthCredential(rawProviderId) {
  const id = providerId(rawProviderId);
  if (!id) return null;
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  if (!bucket || !bucket.activeSlotId) return null;
  const credential = getOAuthCredential(id, bucket.activeSlotId);
  if (!credential) return null;
  return { slotId: bucket.activeSlotId, credential };
}

function listOAuthCredentials(rawProviderId) {
  const id = providerId(rawProviderId);
  if (!id) return [];
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  if (!bucket) return [];
  return accountEntries(bucket).map(([slotId, entry], index) => {
    const credential = decryptCredential(entry.encrypted);
    return {
      providerId: id,
      slotId,
      label: labelForCredential(credential, index + 1),
      active: slotId === bucket.activeSlotId,
      needsReauth: entry.needsReauth === true,
      expiresAt: Number.isFinite(Number(credential && credential.expires)) ? Number(credential.expires) : null,
      hasRefresh: !!String((credential && credential.refresh) || ""),
    };
  });
}

function listAllOAuthCredentialMetadata() {
  return [...SUPPORTED_OAUTH_PROVIDERS].flatMap(listOAuthCredentials);
}

function setActiveOAuthCredential(rawProviderId, slotId) {
  const id = providerId(rawProviderId);
  if (!id) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  if (!bucket || !bucket.accounts[String(slotId)]) throw new Error("등록된 계정을 찾지 못했습니다.");
  bucket.activeSlotId = String(slotId);
  writeStore(store);
  return listOAuthCredentials(id);
}

function markOAuthCredentialNeedsReauth(rawProviderId, slotId, needsReauth = true) {
  const id = providerId(rawProviderId);
  if (!id) return false;
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  const entry = bucket && bucket.accounts[String(slotId)];
  if (!entry) return false;
  entry.needsReauth = needsReauth === true;
  entry.updatedAt = Date.now();
  writeStore(store);
  return true;
}

function removeOAuthCredential(rawProviderId, slotId) {
  const id = providerId(rawProviderId);
  if (!id) return [];
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  if (!bucket || !bucket.accounts[String(slotId)]) return listOAuthCredentials(id);
  delete bucket.accounts[String(slotId)];
  const remaining = accountEntries(bucket);
  if (bucket.activeSlotId === String(slotId)) bucket.activeSlotId = remaining[0]?.[0] || null;
  if (!remaining.length) delete store.providers[id];
  writeStore(store);
  return listOAuthCredentials(id);
}

function allDecryptedOAuthCredentials(rawProviderId) {
  const id = providerId(rawProviderId);
  if (!id) return [];
  const store = readStore();
  const bucket = providerBucket(store, id, false);
  if (!bucket) return [];
  return accountEntries(bucket).map(([slotId, entry], index) => ({
    slotId,
    active: slotId === bucket.activeSlotId,
    needsReauth: entry.needsReauth === true,
    label: labelForCredential(decryptCredential(entry.encrypted), index + 1),
    credential: decryptCredential(entry.encrypted),
  })).filter((row) => row.credential);
}

module.exports = {
  STORE_VERSION,
  SUPPORTED_OAUTH_PROVIDERS,
  providerId,
  credentialStorePath,
  encryptionAvailable,
  readStore,
  normalizedIdentity,
  sameCredentialIdentity,
  maskEmail,
  maskAccountId,
  labelForCredential,
  upsertOAuthCredential,
  getOAuthCredential,
  getActiveOAuthCredential,
  listOAuthCredentials,
  listAllOAuthCredentialMetadata,
  setActiveOAuthCredential,
  markOAuthCredentialNeedsReauth,
  removeOAuthCredential,
  allDecryptedOAuthCredentials,
};