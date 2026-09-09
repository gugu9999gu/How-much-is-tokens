const assert = require("assert");
const {
  decodeJwtPayload,
  normalizeAccountIdentity,
  identityFromClaims,
  accountIdentityText,
} = require("../lib/account-display-identity");

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

console.log("account identity display tests passed");
