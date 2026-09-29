const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { adoptDistinctManagedProfiles } = require("../lib/managed-profile-adoption");
const { normalizeAccountProfiles, rememberManagedAccountIdentities } = require("../lib/account-profiles");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-adopt-"));
const sameDir = path.join(root, "claude", "account-2");
const distinctDir = path.join(root, "claude", "account-6");
const emptyDir = path.join(root, "claude", "account-7");
fs.mkdirSync(sameDir, { recursive: true });
fs.mkdirSync(distinctDir, { recursive: true });
fs.mkdirSync(emptyDir, { recursive: true });

const identities = new Map([
  ["default", "uuid-default"],
  [path.resolve(sameDir).toLowerCase(), "uuid-default"],
  [path.resolve(distinctDir).toLowerCase(), "uuid-pro"],
]);
function identityFor(_providerId, profile) {
  if (!profile || !profile.configDir) return { accountId: identities.get("default") };
  return { accountId: identities.get(path.resolve(profile.configDir).toLowerCase()) || null };
}

const adopted = adoptDistinctManagedProfiles({
  accountProfiles: [{ providerId: "codex", label: "Codex 2", configDir: path.join(root, "codex", "account-2") }],
}, { rootDir: root, identityFor });
const claude = normalizeAccountProfiles(adopted).filter((profile) => profile.providerId === "claude");
assert.strictEqual(claude.length, 1, "only the distinct Claude login should be restored");
assert.strictEqual(claude[0].label, "Claude 6");
assert.strictEqual(claude[0].accountId, "uuid-pro");
assert.strictEqual(path.resolve(claude[0].configDir), path.resolve(distinctDir));

const again = adoptDistinctManagedProfiles({ accountProfiles: adopted }, { rootDir: root, identityFor });
assert.strictEqual(again, null, "an already restored profile must not be added twice");

fs.writeFileSync(path.join(distinctDir, ".claude.json"), JSON.stringify({
  oauthAccount: { accountUuid: "uuid-pro", emailAddress: "pro@example.com" },
}));
const poisoned = normalizeAccountProfiles(adopted).map((profile) => (
  profile.providerId === "claude" ? { ...profile, accountId: "uuid-default" } : profile
));
const remembered = rememberManagedAccountIdentities(poisoned, [
  {
    profileId: claude[0].id,
    status: "ok",
    accountId: "uuid-default",
  },
]);
const kept = (remembered || poisoned).find((profile) => profile.providerId === "claude");
assert.strictEqual(kept.accountId, "uuid-pro", "a conflicting usage identity must not replace the profile directory account id");

fs.rmSync(root, { recursive: true, force: true });
console.log("managed profile adoption tests passed");
