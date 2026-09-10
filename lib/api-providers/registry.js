const falai = require("./falai");
const higgsfield = require("./higgsfield");
const magnific = require("./magnific");
const elevenlabs = require("./elevenlabs");
const stability = require("./stability");
const { officialMcpFor } = require("../media-provider-profiles");

// Extensible registry of generic API-key providers. Adding a new provider is a
// single import + array entry; each module conforms to the standard provider
// interface ({ id, fetchUsage }) plus catalog metadata (name, vendor, detail,
// credentials) used by the settings UI and PROVIDER_META.
const API_PROVIDERS = [falai, higgsfield, magnific, elevenlabs, stability];

function apiProviderById(id) {
  const key = String(id == null ? "" : id).toLowerCase();
  return API_PROVIDERS.find((provider) => provider.id === key) || null;
}

// Data-only view exposed to the renderer (never includes secret values).
function apiProviderCatalog() {
  return API_PROVIDERS.map((provider) => {
    const mcp = officialMcpFor(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      detail: provider.detail,
      vendor: provider.vendor,
      credentials: (provider.credentials || []).map((cred) => ({
        key: cred.key,
        label: cred.label,
        placeholder: cred.placeholder || "",
      })),
      mcp: mcp ? {
        available: true,
        url: mcp.url,
        auth: mcp.auth,
        accountConnect: mcp.auth === "oauth",
      } : { available: false },
    };
  });
}

function apiProviderMeta() {
  const meta = {};
  for (const provider of API_PROVIDERS) {
    meta[provider.id] = {
      vendor: provider.vendor,
      vendorOrder: provider.vendorOrder,
      serviceOrder: provider.serviceOrder,
    };
  }
  return meta;
}

module.exports = {
  API_PROVIDERS,
  apiProviderById,
  apiProviderCatalog,
  apiProviderMeta,
};
