const assert = require("assert");
const { bucketLabel, windowsForAccount } = require("../lib/providers/antigravity");

assert.strictEqual(bucketLabel("gemini-weekly"), "Gemini 주간");
assert.strictEqual(bucketLabel("3p-5h"), "Claude/GPT 5시간");

const windows = windowsForAccount({
  id: "abc123",
  label: "de***@gmail.com",
  observedAt: "2026-09-01T00:00:00Z",
  quota: {
    "gemini-weekly": {
      remaining_fraction: 0.64,
      reset_time: "2026-09-07T00:00:00Z",
    },
    "3p-5h": {
      remaining_fraction: 0.31,
      reset_in_seconds: 3600,
    },
    disabled: {
      remaining_fraction: 0.9,
      disabled: true,
    },
  },
});

assert.strictEqual(windows.length, 2);
assert.strictEqual(windows[0].remainingPct, 64);
assert.strictEqual(windows[1].remainingPct, 31);
assert.match(windows[0].label, /de\*\*\*@gmail\.com/);

console.log("antigravity provider tests passed");
