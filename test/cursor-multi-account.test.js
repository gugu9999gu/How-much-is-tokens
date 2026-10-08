const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getCursorAuth, profileAuthFiles, replacementCursorAuth } = require("../lib/providers/cursor-auth");
const { cursorIdentity } = require("../lib/account-display-identity");

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-cursor-profile-"));
try {
  const profileA = { providerId: "cursor", id: "a", label: "Cursor A", configDir: path.join(root, "a") };
  const profileB = { providerId: "cursor", id: "b", label: "Cursor B", configDir: path.join(root, "b") };
  fs.mkdirSync(profileA.configDir, { recursive: true });
  fs.mkdirSync(profileB.configDir, { recursive: true });
  const tokenA = jwt({ sub: "auth0|cursor-a", email: "a@example.com" });
  const tokenB = jwt({ sub: "auth0|cursor-b", email: "b@example.com" });
  fs.writeFileSync(path.join(profileA.configDir, "auth.json"), JSON.stringify({ accessToken: tokenA }));
  fs.writeFileSync(path.join(profileB.configDir, "auth.json"), JSON.stringify({ accessToken: tokenB }));

  assert.ok(profileAuthFiles(profileA).some((file) => file.endsWith("auth.json")));
  const authA = getCursorAuth({ cursorCookie: "should-not-leak-into-profile" }, profileA);
  const authB = getCursorAuth({}, profileB);
  assert.strictEqual(authA.userId, "cursor-a");
  assert.strictEqual(authB.userId, "cursor-b");
  assert.notStrictEqual(authA.token, authB.token);
  assert.strictEqual(authA.source, "cursor-profile");
  assert.strictEqual(cursorIdentity({}, profileA).accountEmail, "a@example.com");
  assert.strictEqual(cursorIdentity({}, profileB).accountId, "cursor-b", "Cursor identity must use the normalized user id rather than the auth-provider prefix");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const rejected = { userId: "user-1", cookie: "WorkosCursorSessionToken=old" };
const local = { userId: "user-1", cookie: "WorkosCursorSessionToken=current" };
assert.strictEqual(
  replacementCursorAuth(rejected, local, { configuredCookie: true }),
  local,
  "an expired saved cookie must fall back to the current local login for the same account",
);
assert.strictEqual(
  replacementCursorAuth(rejected, { userId: "user-2", cookie: "WorkosCursorSessionToken=other" }, { configuredCookie: true }),
  null,
  "a saved cookie must not be replaced by a different Cursor account",
);
assert.strictEqual(
  replacementCursorAuth(rejected, local, { configuredCookie: true, profile: { id: "account-2" } }),
  null,
  "an extra Cursor profile must keep its own session",
);
assert.strictEqual(replacementCursorAuth(rejected, local, { configuredCookie: false }), null);
assert.strictEqual(
  replacementCursorAuth(rejected, { userId: "user-1", cookie: rejected.cookie }, { configuredCookie: true }),
  null,
);

console.log("Cursor isolated account credential tests passed");
