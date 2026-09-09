const { normalizeAccountProfiles } = require("./account-profiles");

const REMOVABLE_PROFILE_PROVIDERS = new Set(["codex", "claude", "grok"]);

function providerIdForRow(row) {
  if (!row) return "";
  if (row.providerId) return String(row.providerId).toLowerCase();
  return String(row.id || "").split(":")[0].toLowerCase();
}

function verifiedAccountIdentityKey(row) {
  // A stale last-good usage snapshot is display-only evidence. Never use it
  // for a destructive profile-deduplication decision.
  if (!row || row.status !== "ok" || row.stale === true) return null;
  const providerId = providerIdForRow(row);
  const accountKey = String(row.accountKey || "").trim();
  if (!providerId || !accountKey || accountKey.endsWith(":default")) return null;
  return `${providerId}\0${accountKey}`;
}

function profileRemovalKey(providerId, profileId) {
  const provider = String(providerId || "").toLowerCase();
  const profile = String(profileId || "");
  return provider && profile ? `${provider}\0${profile}` : null;
}

function dedupeManagedAccountRows(settings = {}, providerRows = []) {
  const providers = Array.isArray(providerRows) ? providerRows : [];
  const indexed = providers.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const providerCompare = providerIdForRow(a.row).localeCompare(providerIdForRow(b.row));
    if (providerCompare) return providerCompare;
    const orderCompare = (Number(a.row && a.row.accountOrder) || 0) - (Number(b.row && b.row.accountOrder) || 0);
    return orderCompare || a.index - b.index;
  });

  const seen = new Map();
  const removed = new Map();
  const duplicates = [];

  for (const entry of indexed) {
    const row = entry.row;
    const identityKey = verifiedAccountIdentityKey(row);
    if (!identityKey) continue;
    const previous = seen.get(identityKey);
    if (!previous) {
      seen.set(identityKey, row);
      continue;
    }

    let winner = previous;
    let loser = row;
    // A default credential has no profileId and should always win over a
    // managed profile for the same authenticated account.
    if (previous && previous.profileId && !row.profileId) {
      winner = row;
      loser = previous;
      seen.set(identityKey, row);
    }

    const loserProviderId = providerIdForRow(loser);
    // OpenRouter can intentionally keep multiple API keys for one account for
    // request routing. New OAuth +account duplicates are rejected before save
    // in openrouter-main-integration; never delete existing key profiles here.
    if (!REMOVABLE_PROFILE_PROVIDERS.has(loserProviderId)) continue;

    const removalKey = profileRemovalKey(loserProviderId, loser && loser.profileId);
    if (!removalKey) continue;
    removed.set(removalKey, {
      providerId: loserProviderId,
      profileId: String(loser.profileId),
    });
    duplicates.push({
      providerId: loserProviderId,
      profileId: String(loser.profileId),
      accountLabel: loser.accountLabel || null,
      accountEmail: loser.accountEmail || winner.accountEmail || null,
      accountLogin: loser.accountLogin || winner.accountLogin || null,
      accountId: loser.accountId || winner.accountId || null,
      keptAccountLabel: winner.accountLabel || "기본 계정",
    });
  }

  const accountProfiles = normalizeAccountProfiles(settings.accountProfiles).filter((profile) => {
    const key = profileRemovalKey(profile.providerId, profile.id);
    return !key || !removed.has(key);
  });

  if (!removed.size) {
    return {
      providers: [...providers],
      accountProfiles,
      duplicates: [],
      removedProfileKeys: [],
    };
  }

  const filteredProviders = providers.filter((row) => {
    const key = profileRemovalKey(providerIdForRow(row), row && row.profileId);
    return !key || !removed.has(key);
  });

  return {
    providers: filteredProviders,
    accountProfiles,
    duplicates,
    removedProfileKeys: [...removed.keys()],
  };
}

module.exports = {
  REMOVABLE_PROFILE_PROVIDERS,
  providerIdForRow,
  verifiedAccountIdentityKey,
  profileRemovalKey,
  dedupeManagedAccountRows,
};
