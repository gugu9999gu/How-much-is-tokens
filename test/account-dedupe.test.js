const assert = require("assert");
const path = require("path");
const os = require("os");
const { dedupeManagedAccountRows, verifiedAccountIdentityKey } = require("../lib/account-dedupe");

const baseDir = path.join(os.tmpdir(), "how-tokens-dedupe");
const settings = {
  accountProfiles: [
    { providerId: "codex", label: "Codex 2", configDir: path.join(baseDir, "codex-2") },
    { providerId: "codex", label: "Codex 3", configDir: path.join(baseDir, "codex-3") },
  ],
  openRouterProfiles: [],
};
const normalized = require("../lib/account-profiles").normalizeAccountProfiles(settings.accountProfiles);

const rows = [
  {
    id: "codex",
    providerId: "codex",
    status: "ok",
    accountOrder: 0,
    accountKey: "codex:abc123",
    accountEmail: "same@example.com",
    accountId: "acct_same",
    accountLabel: "기본 계정",
  },
  {
    id: `codex:profile:${normalized[0].id}`,
    providerId: "codex",
    profileId: normalized[0].id,
    status: "ok",
    accountOrder: 1,
    accountKey: "codex:abc123",
    accountEmail: "same@example.com",
    accountId: "acct_same",
    accountLabel: "Codex 2",
  },
  {
    id: `codex:profile:${normalized[1].id}`,
    providerId: "codex",
    profileId: normalized[1].id,
    status: "ok",
    accountOrder: 2,
    accountKey: "codex:def456",
    accountEmail: "other@example.com",
    accountId: "acct_other",
    accountLabel: "Codex 3",
  },
];

const result = dedupeManagedAccountRows(settings, rows);
assert.strictEqual(result.duplicates.length, 1, "same authenticated account must be detected as a duplicate");
assert.strictEqual(result.duplicates[0].profileId, normalized[0].id);
assert.strictEqual(result.duplicates[0].accountEmail, "same@example.com");
assert.strictEqual(result.providers.length, 2, "duplicate profile row must not reach the widget");
assert.ok(!result.providers.some((row) => row.profileId === normalized[0].id));
assert.ok(result.providers.some((row) => row.profileId === normalized[1].id));
assert.strictEqual(result.accountProfiles.length, 1, "duplicate managed profile must be removed from settings");
assert.strictEqual(result.accountProfiles[0].id, normalized[1].id);

const openRouterSettings = {
  accountProfiles: [],
  openRouterProfiles: [
    { id: "primary", label: "OpenRouter 1", priority: 10, enabled: true },
    { id: "duplicate", label: "OpenRouter 2", priority: 20, enabled: true },
    { id: "other", label: "OpenRouter 3", priority: 30, enabled: true },
  ],
};
const openRouterRows = [
  {
    id: "openrouter",
    providerId: "openrouter",
    profileId: "primary",
    status: "ok",
    accountOrder: 0,
    accountKey: "openrouter:user-same",
    accountId: "user_2dHFtVWx2n56w6HkM0000000000",
    accountLabel: "OpenRouter 1",
  },
  {
    id: "openrouter",
    providerId: "openrouter",
    profileId: "duplicate",
    status: "ok",
    accountOrder: 1,
    accountKey: "openrouter:user-same",
    accountId: "user_2dHFtVWx2n56w6HkM0000000000",
    accountLabel: "OpenRouter 2",
  },
  {
    id: "openrouter",
    providerId: "openrouter",
    profileId: "other",
    status: "ok",
    accountOrder: 2,
    accountKey: "openrouter:user-other",
    accountId: "user_other",
    accountLabel: "OpenRouter 3",
  },
];
const openRouterResult = dedupeManagedAccountRows(openRouterSettings, openRouterRows);
assert.strictEqual(openRouterResult.duplicates.length, 1, "OAuth keys from the same OpenRouter creator_user_id must collapse to one account");
assert.strictEqual(openRouterResult.duplicates[0].profileId, "duplicate");
assert.deepStrictEqual(openRouterResult.openRouterProfiles.map((profile) => profile.id), ["primary", "other"]);
assert.deepStrictEqual(openRouterResult.providers.map((row) => row.profileId), ["primary", "other"]);

const unknownRows = [
  { id: "claude", providerId: "claude", status: "ok", accountOrder: 0, accountKey: "claude:default" },
  { id: "claude:profile:x", providerId: "claude", profileId: "x", status: "ok", accountOrder: 1, accountKey: "claude:default" },
];
assert.strictEqual(verifiedAccountIdentityKey(unknownRows[0]), null, "unknown/default identity must never be used for destructive deduplication");
const unknown = dedupeManagedAccountRows({ accountProfiles: [], openRouterProfiles: [] }, unknownRows);
assert.strictEqual(unknown.duplicates.length, 0);
assert.strictEqual(unknown.providers.length, 2);

const notVerified = dedupeManagedAccountRows(settings, [
  { ...rows[0], status: "error" },
  { ...rows[1], status: "ok" },
]);
assert.strictEqual(notVerified.duplicates.length, 0, "only successfully verified account identities may trigger deduplication");

const stale = dedupeManagedAccountRows(settings, [
  rows[0],
  { ...rows[1], stale: true, liveStatus: "error" },
]);
assert.strictEqual(verifiedAccountIdentityKey({ ...rows[1], stale: true }), null, "stale last-good usage must not count as fresh account verification");
assert.strictEqual(stale.duplicates.length, 0, "cached usage must never remove an account profile");
assert.strictEqual(stale.accountProfiles.length, 2);

console.log("authenticated account deduplication tests passed");
