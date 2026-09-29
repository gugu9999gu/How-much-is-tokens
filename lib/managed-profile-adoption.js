const fs = require("fs");
const path = require("path");
const { appData } = require("./paths");
const { cleanAccountId, normalizeAccountProfiles } = require("./account-profiles");
const { profileDirectoryAccountId } = require("./account-display-identity");

const MANAGED_PROVIDERS = ["codex", "claude", "grok", "cursor", "copilot"];
const PROVIDER_LABELS = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
  cursor: "Cursor",
  copilot: "Copilot",
};

function managedProfilesRoot() {
  return path.join(appData(), "how-much-is-tokens", "profiles");
}

function listManagedAccountDirs(root, providerId) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, providerId), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^account-\d+$/i.test(entry.name))
    .map((entry) => path.join(root, providerId, entry.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function labelForManagedDir(providerId, configDir) {
  const match = /^account-(\d+)$/i.exec(path.basename(configDir));
  const name = PROVIDER_LABELS[providerId] || providerId;
  return match ? `${name} ${match[1]}` : name;
}

function adoptDistinctManagedProfiles(settings = {}, options = {}) {
  const root = options.rootDir || managedProfilesRoot();
  const identityFor = options.identityFor || ((providerId, profile) => ({
    accountId: profileDirectoryAccountId(profile, providerId),
  }));
  const current = normalizeAccountProfiles(settings.accountProfiles);
  const knownDirs = new Set(current.map((profile) => path.resolve(profile.configDir).toLowerCase()));
  const additions = [];

  for (const providerId of MANAGED_PROVIDERS) {
    const taken = new Set();
    const remember = (value) => {
      const accountId = cleanAccountId(value);
      if (accountId) taken.add(accountId);
    };
    const defaultIdentity = identityFor(providerId, null);
    remember(defaultIdentity && defaultIdentity.accountId);
    for (const profile of current) {
      if (profile.providerId !== providerId) continue;
      remember(profile.accountId);
      if (profile.enabled === false) continue;
      const local = identityFor(providerId, profile);
      remember(local && local.accountId);
    }
    for (const configDir of listManagedAccountDirs(root, providerId)) {
      const dirKey = path.resolve(configDir).toLowerCase();
      if (knownDirs.has(dirKey)) continue;
      const draft = {
        providerId,
        configDir,
        label: labelForManagedDir(providerId, configDir),
        enabled: true,
      };
      const local = identityFor(providerId, draft);
      const accountId = cleanAccountId(local && local.accountId);
      if (!accountId || taken.has(accountId)) continue;
      taken.add(accountId);
      knownDirs.add(dirKey);
      additions.push({ ...draft, accountId });
    }
  }

  if (!additions.length) return null;
  return normalizeAccountProfiles([...current, ...additions]);
}

module.exports = {
  MANAGED_PROVIDERS,
  managedProfilesRoot,
  listManagedAccountDirs,
  labelForManagedDir,
  adoptDistinctManagedProfiles,
};
