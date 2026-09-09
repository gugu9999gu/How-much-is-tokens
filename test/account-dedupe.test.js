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
assert.strictEqual(result.duplicates.length, 1, "same authenticated CLI account must be detected as a duplicate");
assert.strictEqual(result.duplicates[0].profileId, normalized[0].id);
assert.strictEqual(result.duplicates[0].accountEmail, "same@example.com");
assert.strictEqual(result.providers.length, 2, "duplicate CLI profile row must not reach the widget");
assert.ok(!result.providers.some((row) => row.profileId === normalized[0].id));
assert.ok(result.providers.some((row) => row.profileId === normalized[1].id));
assert.strictEqual(result.accountProfiles.length, 1, "duplicate managed CLI profile must be removed from settings");
assert.strictEqual(result.accountProfiles[0].id, normalized[1].id);

// Existing OpenRouter profiles are API-key routing resources, not separate CLI
// auth directories. Even if creator_user_id matches, never delete established
// keys here; +계정 duplicate rejection happens before OAuth profile save.
const openRouterRows = [
  { id: "openrouter", providerId: "openrouter", profileId: "primary", status: "ok", accountOrder: 0, accountKey: "openrouter:user-same", accountId: "user_same" },
  { id: "openrouter", providerId: "openrouter", profileId: "backup", status: "ok", accountOrder: 1, accountKey: "openrouter:user-same", accountId: "user_same" },
];
const openRouterResult = dedupeManagedAccountRows({ accountProfiles: [] }, openRouterRows);
assert.strictEqual(openRouterResult.duplicates.length, 0, "existing OpenRouter multi-key profiles must not be destructively deduplicated");
assert.strictEqual(openRouterResult.providers.length, 2);

const unknownRows = [
  { id: "claude", providerId: "claude", status: "ok", accountOrder: 0, accountKey: "claude:default" },
  { id: "claude:profile:x", providerId: "claude", profileId: "x", status: "ok", accountOrder: 1, accountKey: "claude:default" },
];
assert.strictEqual(verifiedAccountIdentityKey(unknownRows[0]), null, "unknown/default identity must never be used for destructive deduplication");
const unknown = dedupeManagedAccountRows({ accountProfiles: [] }, unknownRows);
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
