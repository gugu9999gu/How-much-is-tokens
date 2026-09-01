const assert = require("assert");
const {
  parseVersion,
  compareVersion,
  supportsPrintUsage,
  parseUsageTsv,
} = require("../lib/antigravity-cli");

assert.deepStrictEqual(parseVersion("agy 1.1.12"), [1, 1, 12]);
assert.deepStrictEqual(parseVersion("Antigravity CLI v2.0.3"), [2, 0, 3]);
assert.strictEqual(parseVersion("unknown"), null);
assert.strictEqual(compareVersion([1, 1, 11], [1, 1, 11]), 0);
assert.strictEqual(compareVersion([1, 1, 12], [1, 1, 11]), 1);
assert.strictEqual(compareVersion([1, 1, 10], [1, 1, 11]), -1);
assert.strictEqual(supportsPrintUsage([1, 1, 10]), false, "old agy must never receive /usage in print mode");
assert.strictEqual(supportsPrintUsage([1, 1, 11]), true);
assert.strictEqual(supportsPrintUsage([1, 2, 0]), true);

const tsv = [
  "Gemini Models\tWeekly Limit Remaining\t82%\t2026-09-07T12:00:00Z",
  "Gemini Models\tFive Hour Limit Remaining\t64%\t2026-09-01T18:00:00Z",
  "Claude and GPT models\tWeekly Limit Remaining\t51%\t2026-09-06T09:00:00Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t33%\t2026-09-01T17:30:00Z",
].join("\n");

const windows = parseUsageTsv(tsv);
assert.deepStrictEqual(windows.map((item) => item.id), [
  "gemini-5h",
  "gemini-weekly",
  "3p-5h",
  "3p-weekly",
]);
assert.deepStrictEqual(windows.map((item) => item.label), [
  "Gemini 5시간 한도",
  "Gemini 주간 한도",
  "Claude/GPT 5시간 한도",
  "Claude/GPT 주간 한도",
]);
assert.deepStrictEqual(windows.map((item) => item.remainingPct), [64, 82, 33, 51]);
assert.strictEqual(windows[0].usedPct, 36);
assert.ok(Number.isFinite(windows[0].resetAt));

console.log("Antigravity CLI live usage tests passed");
