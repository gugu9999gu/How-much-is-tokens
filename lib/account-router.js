const { activeAccountProfiles, profileInstanceKey } = require("./account-profiles");

const ROUTABLE_PROVIDERS = ["codex", "claude", "grok"];
const ROUTING_POLICIES = ["fixed-primary", "priority-fallback", "max-remaining"];
const DEFAULT_PROVIDER_ROUTING = Object.freeze({
  enabled: false,
  policy: "priority-fallback",
  thresholdPct: 0,
});

function clampThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PROVIDER_ROUTING.thresholdPct;
  return Math.max(0, Math.min(100, number));
}

function normalizeProviderRouting(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const policy = ROUTING_POLICIES.includes(source.policy)
    ? source.policy
    : DEFAULT_PROVIDER_ROUTING.policy;
  return {
    enabled: source.enabled === true,
    policy,
    thresholdPct: clampThreshold(source.thresholdPct),
  };
}

function normalizeSmartRouting(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const result = {};
  for (const providerId of ROUTABLE_PROVIDERS) {
    result[providerId] = normalizeProviderRouting(source[providerId]);
  }
  return result;
}

function rowProviderId(row) {
  if (!row || typeof row !== "object") return null;
  if (ROUTABLE_PROVIDERS.includes(row.providerId)) return row.providerId;
  if (ROUTABLE_PROVIDERS.includes(row.id)) return row.id;
  return null;
}

function remainingPct(row) {
  const number = Number(row && row.remainingPct);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function providerCandidates(providerId, providers) {
  if (!ROUTABLE_PROVIDERS.includes(providerId) || !Array.isArray(providers)) return [];
  return providers
    .filter((row) => rowProviderId(row) === providerId)
    .map((row, index) => ({
      row,
      accountOrder: Number.isFinite(Number(row.accountOrder)) ? Number(row.accountOrder) : index,
      remainingPct: remainingPct(row),
    }))
    .sort((a, b) => a.accountOrder - b.accountOrder);
}

function launchable(candidate) {
  return !!candidate && candidate.row && candidate.row.status === "ok";
}

function liveUsable(candidate, thresholdPct) {
  if (!launchable(candidate)) return false;
  if (candidate.row.stale === true) return false;
  if (candidate.row.limitReached === true) return false;
  return candidate.remainingPct != null && candidate.remainingPct > thresholdPct;
}

function selectedResult(providerId, config, candidate, reason) {
  if (!candidate) {
    return {
      ok: false,
      providerId,
      policy: config.policy,
      reason,
    };
  }
  return {
    ok: true,
    providerId,
    policy: config.policy,
    reason,
    row: candidate.row,
    accountOrder: candidate.accountOrder,
    accountLabel: candidate.row.accountLabel || (candidate.accountOrder === 0 ? "기본 계정" : `계정 ${candidate.accountOrder + 1}`),
    remainingPct: candidate.remainingPct,
    instanceKey: candidate.row.instanceKey || null,
  };
}

function selectRoute(providerId, providers, smartRouting) {
  const all = normalizeSmartRouting(smartRouting);
  const config = all[providerId];
  if (!config) return { ok: false, providerId, reason: "unsupported-provider" };
  if (!config.enabled) return { ok: false, providerId, policy: config.policy, reason: "disabled" };

  const candidates = providerCandidates(providerId, providers);
  if (!candidates.length) return selectedResult(providerId, config, null, "no-accounts");

  if (config.policy === "fixed-primary") {
    const primary = candidates.find((candidate) => candidate.accountOrder === 0) || candidates[0];
    return launchable(primary)
      ? selectedResult(providerId, config, primary, "fixed-primary")
      : selectedResult(providerId, config, null, "primary-unavailable");
  }

  const usable = candidates.filter((candidate) => liveUsable(candidate, config.thresholdPct));
  if (!usable.length) return selectedResult(providerId, config, null, "no-usable-account");

  if (config.policy === "max-remaining") {
    const selected = [...usable].sort((a, b) =>
      (b.remainingPct ?? -1) - (a.remainingPct ?? -1) || a.accountOrder - b.accountOrder,
    )[0];
    return selectedResult(providerId, config, selected, "max-remaining");
  }

  return selectedResult(providerId, config, usable[0], usable[0].accountOrder === 0 ? "primary-usable" : "fallback");
}

function profileForSelection(settings, selection) {
  if (!selection || !selection.ok || !selection.instanceKey) return null;
  return activeAccountProfiles(settings).find((profile) => profileInstanceKey(profile) === selection.instanceKey) || null;
}

function annotateRouting(providers, smartRouting) {
  if (!Array.isArray(providers)) return [];
  const selections = new Map();
  for (const providerId of ROUTABLE_PROVIDERS) {
    const selected = selectRoute(providerId, providers, smartRouting);
    if (selected.ok && selected.row) selections.set(selected.row, selected);
  }
  return providers.map((row) => {
    const selected = selections.get(row);
    if (!selected) return row;
    return {
      ...row,
      routeSelected: true,
      routePolicy: selected.policy,
    };
  });
}

module.exports = {
  ROUTABLE_PROVIDERS,
  ROUTING_POLICIES,
  DEFAULT_PROVIDER_ROUTING,
  clampThreshold,
  normalizeProviderRouting,
  normalizeSmartRouting,
  rowProviderId,
  remainingPct,
  providerCandidates,
  launchable,
  liveUsable,
  selectRoute,
  profileForSelection,
  annotateRouting,
};
