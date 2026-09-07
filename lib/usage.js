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
const { activeOpenRouterProfiles } = require("./openrouter-profiles");
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
  result = applyUsageFallback(result);
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

function oauthProfilesForProvider(secrets = {}, credentialProviderId, displayProviderId = credentialProviderId) {
  const rows = secrets && secrets.oauthAccounts && Array.isArray(secrets.oauthAccounts[credentialProviderId])
    ? secrets.oauthAccounts[credentialProviderId]
    : [];
  return rows.map((row) => ({
    id: `oauth-${row.slotId}`,
    providerId: displayProviderId,
    label: row.label || "OAuth 계정",
    enabled: true,
    oauthManaged: true,
    oauthSlotId: row.slotId,
    oauthNeedsReauth: row.needsReauth === true,
    oauthRefreshError: row.refreshError || null,
    authCredential: row.credential || null,
  }));
}

async function fetchAll(settings = {}, secrets = {}) {
  const byProvider = profileMap(settings);
  const jobs = [];

  for (const provider of PROVIDERS) {
    if (provider.id === "openrouter") {
      const apiProfiles = activeOpenRouterProfiles(settings);
      if (apiProfiles.length) {
        apiProfiles.forEach((profile, index) => {
          jobs.push(safeFetch(provider, settings, secrets, profile, null, index));
        });
      } else {
        jobs.push(safeFetch(provider, settings, secrets));
      }
      continue;
    }

    const profiles = byProvider.get(provider.id) || [];
    const credentialProviderId = provider.id === "grokbot" ? "cursor" : provider.id;
    const oauthProfiles = oauthProfilesForProvider(secrets, credentialProviderId, provider.id);

    if (oauthProfiles.length) {
      oauthProfiles.forEach((profile, index) => {
        jobs.push(safeFetch(provider, settings, secrets, profile, null, index));
      });
      // Explicit legacy CLI profiles remain as an advanced fallback, but the
      // default local credential is skipped while this app owns OAuth accounts
      // to avoid duplicate cards for the same identity.
      profiles.forEach((profile, index) => {
        jobs.push(safeFetch(provider, settings, secrets, profile, null, oauthProfiles.length + index));
      });
    } else {
      jobs.push(safeFetch(provider, settings, secrets, null, profiles.length ? "기본 계정" : null, 0));
      profiles.forEach((profile, index) => {
        jobs.push(safeFetch(provider, settings, secrets, profile, null, index + 1));
      });
    }
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
  oauthProfilesForProvider,
};
