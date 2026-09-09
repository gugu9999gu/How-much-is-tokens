const { ipcMain } = require("electron");
const { loadSettings, invalidateSecretStatusCache } = require("./settings");
const { apiProviderById, apiProviderCatalog } = require("./api-providers/registry");
const {
  saveApiProviderSecrets,
  clearApiProviderSecrets,
} = require("./secure-secrets");
require("./window-resize-main-integration");
require("./cli-maintenance-main-integration");

function providerOrThrow(providerId) {
  const provider = apiProviderById(providerId);
  if (!provider) throw new Error("등록되지 않은 API 공급자입니다.");
  return provider;
}

// Only accept credential fields declared by the provider definition, so the
// renderer cannot write arbitrary secret names into the store.
function allowedPatch(provider, patch) {
  const allowed = new Set((provider.credentials || []).map((cred) => cred.key));
  const out = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (allowed.has(field) && typeof value === "string" && value.trim()) {
      out[field] = value.trim();
    }
  }
  return out;
}

ipcMain.handle("get-api-provider-catalog", () => apiProviderCatalog());

ipcMain.handle("save-api-provider-secret", (_event, providerId, patch) => {
  const provider = providerOrThrow(providerId);
  const settings = loadSettings();
  if (settings.secureStorageAvailable !== true) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없어 API 키를 저장할 수 없습니다.");
  }
  const filtered = allowedPatch(provider, patch);
  if (!Object.keys(filtered).length) throw new Error("저장할 API 자격증명이 없습니다.");
  saveApiProviderSecrets(provider.id, filtered);
  invalidateSecretStatusCache();
  return loadSettings();
});

ipcMain.handle("clear-api-provider-secret", (_event, providerId) => {
  const provider = providerOrThrow(providerId);
  clearApiProviderSecrets(provider.id, (provider.credentials || []).map((cred) => cred.key));
  invalidateSecretStatusCache();
  return loadSettings();
});

module.exports = { providerOrThrow, allowedPatch };
