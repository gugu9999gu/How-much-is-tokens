const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  decodeJwtPayload,
  normalizeAccountIdentity,
  identityFromClaims,
  identityFromClaudeAccount,
  identityFromClaudeClaims,
  claudeOauthAccountFiles,
  claudeIdentity,
  accountIdentityText,
} = require("../lib/account-display-identity");
const { home } = require("../lib/paths");

function jwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

const claims = decodeJwtPayload(jwt({
  email: "person@example.com",
  preferred_username: "person",
  sub: "user_123",
}));
assert.ok(claims);
const identity = identityFromClaims(claims);
assert.strictEqual(identity.accountEmail, "person@example.com");
assert.strictEqual(identity.accountLogin, "person");
assert.strictEqual(identity.accountId, "user_123");
assert.strictEqual(accountIdentityText(identity), "person@example.com · person · ID user_123");

const nested = identityFromClaims({
  "https://api.openai.com/profile": { email: "openai@example.com", name: "OpenAI User" },
  "https://api.openai.com/auth": { chatgpt_account_id: "acct_456" },
});
assert.strictEqual(nested.accountEmail, "openai@example.com");
assert.strictEqual(nested.accountId, "acct_456");

const cleaned = normalizeAccountIdentity({
  email: " user@example.com\n",
  accountId: " account-789 ",
});
assert.strictEqual(cleaned.accountEmail, "user@example.com");
assert.strictEqual(cleaned.accountId, "account-789");
assert.strictEqual(accountIdentityText(cleaned), "user@example.com · ID account-789");

const providerRow = normalizeAccountIdentity({ id: "codex", name: "Codex" });
assert.strictEqual(providerRow.accountId, null, "ordinary provider row id must not become an authenticated account id");
assert.strictEqual(providerRow.accountIdentityLabel, null, "ordinary provider name must not become an account identity label");
assert.strictEqual(accountIdentityText(providerRow), "");
assert.strictEqual(decodeJwtPayload("not-a-jwt"), null);

const claudeAccount = identityFromClaudeAccount({
  uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  email: "claude@example.com",
  display_name: "Claude User",
});
assert.strictEqual(claudeAccount.accountEmail, "claude@example.com");
assert.strictEqual(claudeAccount.accountId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
assert.strictEqual(claudeAccount.accountLogin, "Claude User");
assert.strictEqual(accountIdentityText(claudeAccount), "claude@example.com · Claude User · ID aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

const claudeClaims = identityFromClaudeClaims({
  account_uuid: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
  "ccr:account_id": "user_01ABC",
  act: { sub: "user:user_01ABC", email: "claims@example.com" },
});
assert.strictEqual(claudeClaims.accountId, "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", "Claude account UUID wins over the user_ id");
assert.strictEqual(claudeClaims.accountEmail, "claims@example.com");

const defaultAccountFiles = claudeOauthAccountFiles(path.join(home(), ".claude"));
assert.ok(defaultAccountFiles.includes(path.join(home(), ".claude.json")), "the default Claude config dir must also read ~/.claude.json");
const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-identity-"));
const isolatedFiles = claudeOauthAccountFiles(isolatedDir);
assert.ok(!isolatedFiles.includes(path.join(home(), ".claude.json")), "an extra Claude profile must not inherit the primary account file");
fs.writeFileSync(path.join(isolatedDir, ".claude.json"), JSON.stringify({
  userID: "a".repeat(64),
  oauthAccount: {
    accountUuid: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
    emailAddress: "isolated-claude@example.com",
    organizationUuid: "dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee",
    displayName: "Isolated",
  },
}));
fs.writeFileSync(path.join(isolatedDir, ".credentials.json"), JSON.stringify({
  claudeAiOauth: { accessToken: "opaque-token", subscriptionType: "pro" },
}));
const isolated = claudeIdentity({ configDir: isolatedDir });
assert.strictEqual(isolated.accountEmail, "isolated-claude@example.com");
assert.strictEqual(isolated.accountId, "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee", "Claude account UUID must be shown instead of the anonymous userID or organization UUID");
assert.notStrictEqual(isolated.accountId, "d".repeat(36));
fs.rmSync(isolatedDir, { recursive: true, force: true });

console.log("account identity display tests passed");
