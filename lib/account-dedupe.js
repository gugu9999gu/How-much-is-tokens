const { normalizeAccountProfiles } = require("./account-profiles");

function providerIdForRow(row) {
  if (!row) return "";
  if (row.providerId) return String(row.providerId).toLowerCase();
  return String(row.id || "").split(":")[0].toLowerCase();
}

function verifiedAccountIdentityKey(row) {
  if (!row || row.status !== "ok") return null;
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

    const removalKey = profileRemovalKey(providerIdForRow(loser), loser && loser.profileId);
    if (!removalKey) continue;
    removed.set(removalKey, {
      providerId: providerIdForRow(loser),
      profileId: String(loser.profileId),
    });
    duplicates.push({
      providerId: providerIdForRow(loser),
      profileId: String(loser.profileId),
      accountLabel: loser.accountLabel || null,
      accountEmail: loser.accountEmail || winner.accountEmail || null,
      accountLogin: loser.accountLogin || winner.accountLogin || null,
      accountId: loser.accountId || winner.accountId || null,
      keptAccountLabel: winner.accountLabel || "기본 계정",
    });
  }

  if (!removed.size) {
    return {
      providers: [...providers],
      accountProfiles: normalizeAccountProfiles(settings.accountProfiles),
      duplicates: [],
      removedProfileKeys: [],
    };
  }

  const accountProfiles = normalizeAccountProfiles(settings.accountProfiles).filter((profile) => {
    const key = profileRemovalKey(profile.providerId, profile.id);
    return !key || !removed.has(key);
  });
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
  providerIdForRow,
  verifiedAccountIdentityKey,
  profileRemovalKey,
  dedupeManagedAccountRows,
};
