const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getCursorAuth, profileAuthFiles } = require("../lib/providers/cursor-auth");
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
  assert.strictEqual(cursorIdentity({}, profileB).accountId, "auth0|cursor-b");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Cursor isolated account credential tests passed");
