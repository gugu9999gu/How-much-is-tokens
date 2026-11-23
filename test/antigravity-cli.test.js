const assert = require("assert");
const {
  parseVersion,
  compareVersion,
  supportsPrintUsage,
  parseUsageTsv,
  parseUsageJson,
  parseUsageOutput,
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

// Structured /usage output is authoritative. The Argon bucket can be inside
// "Gemini Models" while having a different quota from the shared Gemini pool.
const structured = JSON.stringify({
  status: "SUCCESS",
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            { id: "gemini-weekly", name: "Weekly Limit Remaining", remaining_fraction: 0.8241, reset_time: "2026-11-28T12:00:00Z" },
            { id: "gemini-argon-wtu-weekly", name: "Weekly Limit Remaining", remaining_fraction: 0.37, reset_time: "2026-11-30T12:00:00Z" },
            { id: "gemini-5h", name: "Five Hour Limit Remaining", remaining_fraction: 0, reset_time: "2026-11-23T18:00:00Z" },
            { id: "missing", name: "Weekly Limit Remaining" },
            { id: "invalid", name: "Weekly Limit Remaining", remaining_fraction: "not-a-number" },
            { id: "disabled", name: "Weekly Limit Remaining", remaining_fraction: 0.8, disabled: true },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [{ id: "3p-weekly", name: "Weekly Limit Remaining", remaining_fraction: 0.53, reset_time: "2026-11-29T12:00:00Z" }],
        },
      ],
    },
  },
});
const parsedJson = parseUsageJson(structured);
assert.deepStrictEqual(parsedJson.map((item) => item.id), [
  "gemini-5h",
  "gemini-weekly",
  "3p-weekly",
  "gemini-argon-wtu-weekly",
]);
assert.deepStrictEqual(parsedJson.map((item) => item.remainingPct), [0, 82.41, 53, 37]);
assert.strictEqual(parsedJson.find((item) => item.id === "gemini-5h").usedPct, 100);
assert.strictEqual(parsedJson.find((item) => item.id === "gemini-argon-wtu-weekly").label, "Gemini 4 Argon 주간 한도");
assert.strictEqual(parsedJson.find((item) => item.id === "gemini-weekly").label, "Gemini 주간 한도");
assert.ok(Number.isFinite(parsedJson.find((item) => item.id === "gemini-argon-wtu-weekly").resetAt));
assert.deepStrictEqual(parseUsageOutput(structured), parsedJson);
assert.deepStrictEqual(parseUsageOutput(tsv), windows);
assert.deepStrictEqual(parseUsageJson('{"status":"ERROR","command":{"data":{"groups":[]}}}'), []);
assert.deepStrictEqual(parseUsageJson("{invalid"), []);
assert.deepStrictEqual(parseUsageJson('{"groups":[{"name":"Gemini Models","buckets":[{"id":"gemini-weekly","remaining_fraction":null,"name":"Weekly Limit Remaining"}]}]}'), []);

const separateTsv = parseUsageTsv([
  "Gemini Models\tWeekly Limit Remaining\t70%\t2026-11-29T12:00:00Z",
  "Gemini 4 Argon\tWeekly Limit Remaining\t25%\t2026-11-30T12:00:00Z",
  "Claude and GPT models\tWeekly Limit Remaining\t33%\t2026-12-01T12:00:00Z",
].join("\n"));
assert.deepStrictEqual(separateTsv.map((item) => item.id), [
  "gemini-weekly",
  "3p-weekly",
  "gemini-4-argon-weekly",
]);
assert.strictEqual(separateTsv[2].remainingPct, 25);

console.log("Antigravity CLI live usage tests passed");
