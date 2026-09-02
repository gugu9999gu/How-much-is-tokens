const claude = require("./providers/claude");
const codex = require("./providers/codex");
const cursor = require("./providers/cursor");
const copilot = require("./providers/copilot");
const grok = require("./providers/grok");
const grokbot = require("./providers/grokbot");
const antigravity = require("./providers/antigravity");
const { applyUsageFallback } = require("./usage-cache");

const PROVIDERS = [claude, cursor, grokbot, codex, copilot, grok, antigravity];

const PROVIDER_META = {
  codex: { vendor: "OpenAI", vendorOrder: 10, serviceOrder: 10 },
  claude: { vendor: "Anthropic", vendorOrder: 20, serviceOrder: 10 },
  antigravity: { vendor: "Google", vendorOrder: 30, serviceOrder: 10 },
  grok: { vendor: "xAI", vendorOrder: 40, serviceOrder: 10 },
  grokbot: { vendor: "xAI", vendorOrder: 40, serviceOrder: 20 },
  cursor: { vendor: "Cursor", vendorOrder: 50, serviceOrder: 10 },
  copilot: { vendor: "GitHub", vendorOrder: 60, serviceOrder: 10 },
};

function providerMeta(id) {
  return PROVIDER_META[id] || { vendor: "기타", vendorOrder: 999, serviceOrder: 999 };
}

function decorateProvider(provider, result) {
  return {
    ...result,
    ...providerMeta(provider.id),
  };
}

function sortProviders(providers) {
  return [...providers].sort((a, b) =>
    (a.vendorOrder ?? 999) - (b.vendorOrder ?? 999) ||
    (a.serviceOrder ?? 999) - (b.serviceOrder ?? 999) ||
    String(a.name || a.id || "").localeCompare(String(b.name || b.id || "")),
  );
}

async function safeFetch(provider, settings) {
  let result;
  try {
    result = await provider.fetchUsage(settings || {});
  } catch (err) {
    result = {
      id: provider.id,
      name: provider.id,
      status: "error",
      error: err.message || String(err),
    };
  }

  // Keep a last-known-good quota snapshot independently of the renderer/main
  // process cache. This survives widget restarts and prevents a short-lived
  // CLI access-token expiry from erasing every gauge. Expired quota windows
  // are filtered by their own resetAt boundary before reuse.
  result = applyUsageFallback(result);
  return decorateProvider(provider, result);
}

async function fetchAll(settings = {}) {
  const providers = await Promise.all(PROVIDERS.map((provider) => safeFetch(provider, settings)));
  return {
    fetchedAt: Date.now(),
    providers: sortProviders(providers),
  };
}

module.exports = { fetchAll, PROVIDERS, PROVIDER_META, providerMeta, sortProviders };
