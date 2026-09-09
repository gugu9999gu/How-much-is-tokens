const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  tokenFromGhCli,
  findProfileToken,
  findToken,
  quotaWindow,
  premiumRequestBalance,
} = require("../lib/providers/copilot");

const resetAt = Date.parse("2026-10-01T00:00:00Z");
const snapshot = { entitlement: 300, remaining: 75, percent_remaining: 25 };

const ghToken = ["gh", "oauth", "fixture", "token"].join("-");
let ghCall = null;
assert.strictEqual(tokenFromGhCli((command, args, options) => {
  ghCall = { command, args, options };
  return `${ghToken}\n`;
}, {}), ghToken);
assert.strictEqual(ghCall.command, "gh");
assert.deepStrictEqual(ghCall.args, ["auth", "token"]);
assert.strictEqual(ghCall.options.windowsHide, true);
assert.strictEqual(tokenFromGhCli(() => { throw new Error("not logged in"); }, {}), null);

const foundFromGh = findToken({ githubToken: "" }, { execFileSyncImpl: () => ghToken, env: {} });
assert.ok(foundFromGh);
assert.strictEqual(foundFromGh.token, ghToken);
assert.strictEqual(foundFromGh.source, "gh auth");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-copilot-profile-"));
try {
  const profile = { id: "gh2", providerId: "copilot", label: "Copilot 2", configDir: root };
  fs.writeFileSync(path.join(root, "hosts.yml"), [
    "github.com:",
    "    user: second-user",
    "    oauth_token: profile-token-2",
    "    git_protocol: https",
    "",
  ].join("\n"));
  const profileToken = findProfileToken(profile, { execFileSyncImpl: () => { throw new Error("must prefer profile hosts file"); } });
  assert.strictEqual(profileToken.token, "profile-token-2");
  assert.strictEqual(findToken({ githubToken: "global-must-not-leak" }, { profile }).token, "profile-token-2");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const window = quotaWindow(snapshot, "premium", "프리미엄", resetAt);
assert.ok(window);
assert.strictEqual(window.remainingPct, 25);
assert.strictEqual(window.usedPct, 75);
assert.strictEqual(window.remaining, 75);
assert.strictEqual(window.entitlement, 300);

const balance = premiumRequestBalance(snapshot, resetAt);
assert.ok(balance);
assert.strictEqual(balance.label, "프리미엄 요청");
assert.strictEqual(balance.balance, 75);
assert.strictEqual(balance.used, 225);
assert.strictEqual(balance.limit, 300);
assert.strictEqual(balance.unit, "요청");
assert.strictEqual(balance.remainingPct, 25);
assert.strictEqual(balance.resetAt, resetAt);

const unlimited = premiumRequestBalance({ unlimited: true }, resetAt);
assert.ok(unlimited);
assert.strictEqual(unlimited.unlimited, true);
assert.strictEqual(unlimited.unit, "요청");
assert.strictEqual(unlimited.remainingPct, 100);

assert.strictEqual(premiumRequestBalance({ entitlement: 0, remaining: 0 }, resetAt), null);
assert.strictEqual(premiumRequestBalance({}, resetAt), null);

console.log("Copilot profile credential / premium request balance tests passed");
