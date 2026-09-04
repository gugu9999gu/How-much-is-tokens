const claude = require("./providers/claude");
const codex = require("./providers/codex");
const cursor = require("./providers/cursor");
const copilot = require("./providers/copilot");
const grok = require("./providers/grok");
const grokbot = require("./providers/grokbot");
const antigravity = require("./providers/antigravity");
const openrouter = require("./providers/openrouter");
const { applyUsageFallback } = require("./usage-cache");
const { activeAccountProfiles, profileInstanceKey } = require("./account-profiles");
const { derivedRoutingRemainingPct } = require("./account-router");

const PROVIDERS = [claude, cursor, grokbot, codex, copilot, grok, antigravity, openrouter];

const PROVIDER_META = {
  codex: { vendor: "OpenAI", vendorOrder: 10, serviceOrder: 10 },
  claude: { vendor: "Anthropic", vendorOrder: 20, serviceOrder: 10 },
  antigravity: { vendor: "Google", vendorOrder: 30, serviceOrder: 10 },
  grok: { vendor: "xAI", vendorOrder: 40, serviceOrder: 10 },
  grokbot: { vendor: "xAI", vendorOrder: 40, serviceOrder: 20 },
  cursor: { vendor: "Cursor", vendorOrder: 50, serviceOrder: 10 },
  copilot: { vendor: "GitHub", vendorOrder: 60, serviceOrder: 10 },
  openrouter: { vendor: "API 공급자", vendorOrder: 70, serviceOrder: 10 },
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
    (a.accountOrder ?? 0) - (b.accountOrder ?? 0) ||
    String(a.name || a.id || "").localeCompare(String(b.name || b.id || "")),
  );
}

function withAccountContext(result, profile, defaultLabel, accountOrder) {
  const next = { ...(result || {}) };
  if (profile) {
    const instanceKey = profileInstanceKey(profile);
    next.providerId = next.providerId || profile.providerId || next.id;
    next.accountLabel = profile.label;
    next.instanceKey = instanceKey;
    // main.js keeps a short-lived in-memory cache keyed by id. Explicit
    // profile cards therefore need a unique runtime id as well as instanceKey,
    // otherwise an error on account #2 could reuse account #1's live snapshot.
    if (instanceKey) next.id = instanceKey;
  } else if (defaultLabel && !next.accountLabel) {
    next.accountLabel = defaultLabel;
  }
  next.accountOrder = accountOrder;
  next.routingRemainingPct = derivedRoutingRemainingPct(next);
  return next;
}

async function safeFetch(provider, settings, secrets, profile = null, defaultLabel = null, accountOrder = 0) {
  let result;
  try {
    result = await provider.fetchUsage(settings || {}, secrets || {}, profile);
  } catch (err) {
    result = {
      id: provider.id,
      name: provider.id,
      status: "error",
      error: err.message || String(err),
    };
  }

  result = withAccountContext(result, profile, defaultLabel, accountOrder);

  // Keep a last-known-good quota snapshot independently of the renderer/main
  // process cache. Explicit profiles use their stable profile instance key,
  // while the default login continues to use the provider's accountKey. This
  // prevents stale data from one isolated profile appearing on another card.
  result = applyUsageFallback(result);
  // Persistent snapshots intentionally contain only display-safe fields. Reapply
  // runtime-only account ordering/labels after fallback so a transient error
  // cannot reorder cards or drop the "기본 계정" marker.
  result = withAccountContext(result, profile, defaultLabel, accountOrder);
  return decorateProvider(provider, result);
}

function profileMap(settings = {}) {
  const map = new Map();
  for (const profile of activeAccountProfiles(settings)) {
    if (!map.has(profile.providerId)) map.set(profile.providerId, []);
    map.get(profile.providerId).push(profile);
  }
  return map;
}

async function fetchAll(settings = {}, secrets = {}) {
  const byProvider = profileMap(settings);
  const jobs = [];

  for (const provider of PROVIDERS) {
    const profiles = byProvider.get(provider.id) || [];
    jobs.push(safeFetch(provider, settings, secrets, null, profiles.length ? "기본 계정" : null, 0));
    profiles.forEach((profile, index) => {
      jobs.push(safeFetch(provider, settings, secrets, profile, null, index + 1));
    });
  }

  const providers = await Promise.all(jobs);
  return {
    fetchedAt: Date.now(),
    providers: sortProviders(providers),
  };
}

module.exports = {
  fetchAll,
  PROVIDERS,
  PROVIDER_META,
  providerMeta,
  sortProviders,
  withAccountContext,
  profileMap,
};
