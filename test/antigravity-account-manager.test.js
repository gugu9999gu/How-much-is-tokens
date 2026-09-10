const assert = require("assert");
const {
  AGM_COMMIT,
  AGM_REPOSITORY,
  parseAccountList,
  parseAccountInfo,
  fallbackWindows,
  profileIdForEmail,
} = require("../lib/antigravity-account-manager");

assert.strictEqual(AGM_COMMIT, "1d3ce8497e36ffa60c3b4e369168315a7ae4d469");
assert.strictEqual(AGM_REPOSITORY, `github.com/shyim/agm@${AGM_COMMIT}`);
assert.ok(!AGM_REPOSITORY.endsWith("@latest"), "credential-switching helper must be pinned to a reviewed commit");

const accounts = parseAccountList(`
EMAIL                                STATUS          GEM-PRO  GEM-FLASH   CLAUDE
------------------------------------ -------------- ------- ---------- --------
a@example.com                        cli,active        82%        73%      61%
b@example.com                                          25%        40%      55%
c@example.com                        token-exp          0%         0%       0%
`);
assert.strictEqual(accounts.length, 3);
assert.strictEqual(accounts[0].email, "a@example.com");
assert.strictEqual(accounts[0].active, true);
assert.strictEqual(accounts[0].summary.gemPro, 82);
assert.strictEqual(accounts[1].status, "");
assert.strictEqual(accounts[1].summary.gemFlash, 40);
assert.strictEqual(accounts[2].tokenExpired, true);

const windows = parseAccountInfo(`
Account: a@example.com
Status: active
TYPE         MODEL                                              USAGE  RESET
GOOGLE       gemini-3.1-pro-high                                  82%  2026-09-10T10:00:00Z
GOOGLE       gemini-3-flash                                       73%  2026-09-10T11:00:00Z
ANTHROPIC    claude-sonnet-4-5                                    61%  2026-09-10T12:00:00Z
`);
assert.strictEqual(windows.length, 3);
assert.strictEqual(windows[0].label, "gemini-3.1-pro-high");
assert.strictEqual(windows[0].remainingPct, 82);
assert.ok(Number.isFinite(windows[0].resetAt));

const fallback = fallbackWindows(accounts[0]);
assert.deepStrictEqual(fallback.map((row) => row.remainingPct), [82, 73, 61]);
assert.strictEqual(profileIdForEmail("User@Example.com"), profileIdForEmail("user@example.com"));
assert.ok(profileIdForEmail("a@example.com").startsWith("agm-"));

console.log("Antigravity encrypted multi-account adapter tests passed");
