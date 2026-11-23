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

// A registered AGM account is not a substitute for a fresh CLI /usage result.
const { combineAntigravityRows } = require("../lib/usage");
const saved = [{
  id: "antigravity:agm-account",
  accountLabel: "기본 계정",
  status: "ok",
  remainingPct: 21,
  windows: [{ id: "gemini-pro", remainingPct: 21, source: "agm" }],
}];
const current = {
  id: "antigravity",
  status: "ok",
  stale: false,
  remainingPct: 75,
  windows: [{ id: "gemini-weekly", remainingPct: 75, source: "agy-print-usage" }],
};
const combined = combineAntigravityRows(saved, current);
assert.strictEqual(combined.length, 2, "live CLI quota must remain visible even with AGM installed");
assert.strictEqual(combined[0].remainingPct, 75);
assert.strictEqual(combined[0].accountLabel, "현재 CLI · 실시간");
assert.strictEqual(combined[1].remainingPct, 21);
assert.strictEqual(combined[1].stale, true, "AGM DB snapshots must not be presented as live quota");
assert.deepStrictEqual(combineAntigravityRows(saved, { ...current, stale: true }), [
  { ...saved[0], stale: true, staleReason: "AGM 마지막 저장값",
    extras: [{ label: "사용량 출처", value: "AGM 저장값" }] },
]);
assert.deepStrictEqual(combineAntigravityRows([], current), [current]);

console.log("Antigravity encrypted multi-account adapter tests passed");
