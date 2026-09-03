const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { readJson, writeJson } = require("./paths");

const STORE_VERSION = 1;
const ALLOWED_SECRETS = new Set([
  "openrouterApiKey",
  "openrouterManagementKey",
]);

function secretsPath() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function encryptionAvailable() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readStore() {
  const data = readJson(secretsPath());
  if (!data || data.version !== STORE_VERSION || !data.values || typeof data.values !== "object") {
    return { version: STORE_VERSION, values: {} };
  }
  return data;
}

function assertAllowed(name) {
  if (!ALLOWED_SECRETS.has(name)) throw new Error(`Unsupported secret: ${name}`);
}

function decryptSecret(encoded) {
  if (!encoded || !encryptionAvailable()) return null;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(String(encoded), "base64"));
    return decrypted || null;
  } catch {
    return null;
  }
}

function getSecret(name) {
  assertAllowed(name);
  const store = readStore();
  return decryptSecret(store.values[name]);
}

function saveSecrets(patch = {}) {
  if (!encryptionAvailable()) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없습니다. 키는 평문으로 저장하지 않습니다.");
  }

  const store = readStore();
  let changed = false;
  for (const name of ALLOWED_SECRETS) {
    if (!Object.prototype.hasOwnProperty.call(patch, name)) continue;
    const value = typeof patch[name] === "string" ? patch[name].trim() : "";
    if (!value) continue;
    store.values[name] = safeStorage.encryptString(value).toString("base64");
    changed = true;
  }

  if (changed) {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
    writeJson(secretsPath(), store);
  }
  return secretStatus();
}

function clearSecrets(names = []) {
  const requested = Array.isArray(names) ? names : [names];
  const store = readStore();
  let changed = false;

  for (const name of requested) {
    assertAllowed(name);
    if (Object.prototype.hasOwnProperty.call(store.values, name)) {
      delete store.values[name];
      changed = true;
    }
  }

  if (changed) {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
    writeJson(secretsPath(), store);
  }
  return secretStatus();
}

function secretStatus() {
  return {
    encryptionAvailable: encryptionAvailable(),
    openrouterApiKeyConfigured: !!getSecret("openrouterApiKey"),
    openrouterManagementKeyConfigured: !!getSecret("openrouterManagementKey"),
  };
}

function loadProviderSecrets() {
  return {
    openrouter: {
      apiKey: getSecret("openrouterApiKey"),
      managementKey: getSecret("openrouterManagementKey"),
    },
  };
}

module.exports = {
  STORE_VERSION,
  ALLOWED_SECRETS,
  secretsPath,
  encryptionAvailable,
  getSecret,
  saveSecrets,
  clearSecrets,
  secretStatus,
  loadProviderSecrets,
};
