const claude = require("./providers/claude");
const codex = require("./providers/codex");
const cursor = require("./providers/cursor");
const copilot = require("./providers/copilot");
const grok = require("./providers/grok");
const grokbot = require("./providers/grokbot");
const antigravity = require("./providers/antigravity");
const openrouter = require("./providers/openrouter");
const { API_PROVIDERS, apiProviderMeta } = require("./api-providers/registry");
const { applyUsageFallback } = require("./usage-cache");
const { activeAccountProfiles, profileInstanceKey, rememberManagedAccountIdentities } = require("./account-profiles");
const { activeOpenRouterProfiles, rememberOpenRouterAccountIds } = require("./openrouter-profiles");
const {
  activeMediaProviderProfiles,
  mediaProfileInstanceKey,
  officialMcpFor,
} = require("./media-provider-profiles");
const { fetchMediaMcpUsage } = require("./media-mcp-client");
const { derivedRoutingRemainingPct } = require("./account-router");
const { withPlanRenewal } = require("./plan-access");
const { resolveLocalAccountIdentity } = require("./account-display-identity");
const { dedupeManagedAccountRows } = require("./account-dedupe");
const { listManagedUsageRows } = require("./antigravity-account-manager");

const PROVIDERS = [claude, cursor, grokbot, codex, copilot, grok, antigravity, openrouter, ...API_PROVIDERS];

const PROVIDER_META = {
  codex: { vendor: "OpenAI", vendorOrder: 10, serviceOrder: 10 },
  claude: { vendor: "Anthropic", vendorOrder: 20, serviceOrder: 10 },
  antigravity: { vendor: "Google", vendorOrder: 30, serviceOrder: 10 },
  grok: { vendor: "xAI", vendorOrder: 40, serviceOrder: 10 },
  grokbot: { vendor: "xAI", vendorOrder: 40, serviceOrder: 20 },
  cursor: { vendor: "Cursor", vendorOrder: 50, serviceOrder: 10 },
  copilot: { vendor: "GitHub", vendorOrder: 60, serviceOrder: 10 },
  openrouter: { vendor: "API 공급자", vendorOrder: 70, serviceOrder: 10 },
  ...apiProviderMeta(),
};

function providerMeta(id) {
  return PROVIDER_META[id] || { vendor: "기타", vendorOrder: 999, serviceOrder: 999 };
}

function decorateProvider(provider, result) {
  return withPlanRenewal({ ...result, ...providerMeta(provider.id) });
}

function sortProviders(providers) {
  return [...providers].sort((a, b) =>
    (a.vendorOrder ?? 999) - (b.vendorOrder ?? 999) ||
    (a.serviceOrder ?? 999) - (b.serviceOrder ?? 999) ||
    (a.accountOrder ?? 0) - (b.accountOrder ?? 0) ||
    String(a.name || a.id || "").localeCompare(String(b.name || b.id || "")),
  );
}

function disabledDefaultProviders(settings = {}) {
  return new Set((Array.isArray(settings.disabledCredentialProviders) ? settings.disabledCredentialProviders : [])
    .map((id) => String(id || "").toLowerCase()));
}

function defaultProviderDisabled(settings, providerId) {
  const disabled = disabledDefaultProviders(settings);
  const id = String(providerId || "").toLowerCase();
  if (disabled.has(id)) return true;
  return id === "grokbot" && disabled.has("cursor");
}

function withAccountContext(result, profile, defaultLabel, accountOrder) {
  const next = { ...(result || {}) };
  if (profile) {
    const instanceKey = profileInstanceKey(profile);
    next.profileId = profile.id || next.profileId || null;
    next.providerId = next.providerId || profile.providerId || next.id;
    next.accountLabel = profile.label || next.accountLabel;
    next.instanceKey = instanceKey || next.instanceKey;
    if (instanceKey) next.id = instanceKey;
  } else if (defaultLabel && !next.accountLabel) {
    next.accountLabel = defaultLabel;
  }
  next.accountOrder = accountOrder;
  next.routingRemainingPct = derivedRoutingRemainingPct(next);
  return next;
}

function withMediaContext(provider, result, profile, accountOrder) {
  const next = { ...(result || {}) };
  const instanceKey = mediaProfileInstanceKey(profile);
  next.providerId = provider.id;
  next.profileId = profile.id;
  next.accountLabel = profile.label;
  next.connectionMode = profile.mode;
  next.instanceKey = instanceKey;
  if (instanceKey) next.id = instanceKey;
  next.accountOrder = accountOrder;
  return next;
}

function withDisplayIdentity(provider, result, settings, profile) {
  const identity = resolveLocalAccountIdentity(provider.id, settings || {}, profile, result || {});
  return { ...(result || {}), ...identity };
}

async function safeFetch(provider, settings, secrets, profile = null, defaultLabel = null, accountOrder = 0) {
  let result;
  try {
    result = await provider.fetchUsage(settings || {}, secrets || {}, profile);
  } catch (err) {
    result = { id: provider.id, name: provider.id, status: "error", error: err.message || String(err) };
  }

  result = withDisplayIdentity(provider, result, settings, profile);
  result = withAccountContext(result, profile, defaultLabel, accountOrder);
  result = applyUsageFallback(result);
  result = withDisplayIdentity(provider, result, settings, profile);
  result = withAccountContext(result, profile, defaultLabel, accountOrder);
  return decorateProvider(provider, result);
}

async function safeFetchMedia(provider, settings, secrets, profile, accountOrder = 1) {
  let result;
  try {
    if (profile.mode === "mcp") {
      const mcp = officialMcpFor(provider.id);
      result = mcp ? await fetchMediaMcpUsage(provider, profile) : null;
      if (!result || result.status !== "ok") {
        if (mcp && mcp.restFallback) {
          const fallback = await provider.fetchUsage(settings || {}, secrets || {}, profile);
          if (fallback && fallback.status === "ok") {
            result = {
              ...fallback,
              extras: [
                ...(Array.isArray(fallback.extras) ? fallback.extras : []),
                { label: "연결", value: "REST fallback" },
              ],
              mcpConnected: result && result.mcpConnected === true,
              mcpFallbackReason: result && result.mcpReason,
            };
          }
        }
      }
      if (!result) {
        result = { id: provider.id, name: provider.name, brand: provider.brand, status: "error", error: "MCP 조회 경로를 사용할 수 없습니다." };
      }
    } else {
      result = await provider.fetchUsage(settings || {}, secrets || {}, profile);
    }
  } catch (err) {
    result = { id: provider.id, name: provider.name, brand: provider.brand, status: "error", error: err.message || String(err) };
  }

  result = withMediaContext(provider, result, profile, accountOrder);
  result = applyUsageFallback(result);
  result = withMediaContext(provider, result, profile, accountOrder);
  return decorateProvider(provider, result);
}

function profileMap(settings = {}) {
  const map = new Map();
  for (const profile of activeAccountProfiles(settings)) {
    if (!map.has(profile.providerId)) map.set(profile.providerId, []);
    map.get(profile.providerId).push(profile);
    if (profile.providerId === "cursor") {
      if (!map.has("grokbot")) map.set("grokbot", []);
      map.get("grokbot").push({ ...profile, providerId: "grokbot" });
    }
  }
  return map;
}

async function antigravityRows(settings, secrets) {
  try {
    const managed = await listManagedUsageRows();
    if (Array.isArray(managed) && managed.length) {
      return managed.map((row, index) => {
        let result = { ...row, accountOrder: index, routingRemainingPct: derivedRoutingRemainingPct(row) };
        result = applyUsageFallback(result);
        result.routingRemainingPct = derivedRoutingRemainingPct(result);
        return decorateProvider(antigravity, result);
      });
    }
  } catch {}
  if (defaultProviderDisabled(settings, "antigravity")) return [];
  return [await safeFetch(antigravity, settings, secrets)];
}

function reconcileDuplicateManagedAccounts(providers) {
  let current = { accountProfiles: [], openRouterProfiles: [] };
  try {
    const { loadSettings } = require("./settings");
    current = loadSettings() || current;
  } catch {}

  const reconciliation = dedupeManagedAccountRows(current, providers);
  const rememberedProfiles = rememberManagedAccountIdentities(reconciliation.accountProfiles, reconciliation.providers);
  const rememberedOpenRouter = rememberOpenRouterAccountIds(current.openRouterProfiles, reconciliation.providers);
  const patch = {};
  if (reconciliation.duplicates.length || rememberedProfiles) {
    patch.accountProfiles = rememberedProfiles || reconciliation.accountProfiles;
  }
  if (rememberedOpenRouter) patch.openRouterProfiles = rememberedOpenRouter;
  if (Object.keys(patch).length) {
    try {
      const { saveSettings } = require("./settings");
      saveSettings(patch);
    } catch {}
  }
  return reconciliation;
}

function settingsWithAdoptedProfiles(settings) {
  try {
    const { adoptDistinctManagedProfiles } = require("./managed-profile-adoption");
    const adopted = adoptDistinctManagedProfiles(settings);
    if (!adopted) return settings;
    const { saveSettings } = require("./settings");
    return saveSettings({ accountProfiles: adopted });
  } catch {
    return settings;
  }
}

async function fetchAll(settings = {}, secrets = {}) {
  const activeSettings = settingsWithAdoptedProfiles(settings);
  const byProvider = profileMap(activeSettings);
  const jobs = [];

  for (const provider of PROVIDERS) {
    if (provider.id === "antigravity") {
      jobs.push(antigravityRows(activeSettings, secrets));
      continue;
    }

    if (provider.id === "openrouter") {
      const apiProfiles = activeOpenRouterProfiles(activeSettings);
      if (apiProfiles.length) apiProfiles.forEach((profile, index) => jobs.push(safeFetch(provider, activeSettings, secrets, profile, null, index)));
      else jobs.push(safeFetch(provider, activeSettings, secrets));
      continue;
    }

    if (API_PROVIDERS.includes(provider)) {
      // Keep the legacy/default credential slot for existing users, then append
      // any explicitly added API/MCP account profiles as separate widget cards.
      jobs.push(safeFetch(provider, activeSettings, secrets, null, null, 0));
      const mediaProfiles = activeMediaProviderProfiles(activeSettings, provider.id);
      mediaProfiles.forEach((profile, index) => jobs.push(safeFetchMedia(provider, activeSettings, secrets, profile, index + 1)));
      continue;
    }

    const profiles = byProvider.get(provider.id) || [];
    if (!defaultProviderDisabled(activeSettings, provider.id)) jobs.push(safeFetch(provider, activeSettings, secrets, null, profiles.length ? "기본 계정" : null, 0));
    profiles.forEach((profile, index) => jobs.push(safeFetch(provider, activeSettings, secrets, profile, null, index + 1)));
  }

  const fetched = await Promise.all(jobs);
  const fetchedProviders = sortProviders(fetched.flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean));
  const reconciliation = reconcileDuplicateManagedAccounts(fetchedProviders);
  return {
    fetchedAt: Date.now(),
    providers: sortProviders(reconciliation.providers),
    deduplicatedAccounts: reconciliation.duplicates,
  };
}

module.exports = {
  fetchAll,
  PROVIDERS,
  PROVIDER_META,
  providerMeta,
  sortProviders,
  disabledDefaultProviders,
  defaultProviderDisabled,
  withAccountContext,
  withMediaContext,
  withDisplayIdentity,
  safeFetchMedia,
  profileMap,
  antigravityRows,
  reconcileDuplicateManagedAccounts,
};
