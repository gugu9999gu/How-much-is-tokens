const assert = require("assert");
const {
  AGM_COMMIT,
  AGM_REPOSITORY,
  parseAccountList,
  parseAccountInfo,
  fallbackWindows,
  profileIdForEmail,
  listManagedUsageRows,
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

(async () => {
  const listFixture = `
EMAIL                                STATUS          GEM-PRO  GEM-FLASH   CLAUDE
------------------------------------ -------------- ------- ---------- --------
a@example.com                        cli,active        82%        73%       5%
`;
  const infoFixture = `
Account: a@example.com
Status: active
TYPE         MODEL                                              USAGE  RESET
GOOGLE       gemini-3.1-pro-high                                  82%  2026-09-10T10:00:00Z
GOOGLE       gemini-3-flash                                       73%  2026-09-10T11:00:00Z
ANTHROPIC    claude-sonnet-4-5                                     5%  2026-09-10T09:30:00Z
`;
  const rows = await listManagedUsageRows({
    executable: "agm-fixture",
    execFileImpl(_command, args, _options, callback) {
      if (args[0] === "list") callback(null, listFixture, "");
      else if (args[0] === "info") callback(null, infoFixture, "");
      else callback(new Error(`unexpected args: ${args.join(" ")}`), "", "");
    },
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(
    rows[0].remainingPct,
    73,
    "managed Antigravity compact summary must use the tightest Gemini quota, not the lower Claude quota",
  );
  assert.strictEqual(rows[0].usedPct, 27);
  assert.strictEqual(rows[0].windows.length, 3, "detailed Antigravity mode must still retain Claude/GPT quota windows");
  assert.ok(rows[0].windows.some((row) => /claude/i.test(row.label)));
  assert.strictEqual(rows[0].resetAt, Date.parse("2026-09-10T11:00:00Z"));

  console.log("Antigravity encrypted multi-account adapter tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
