const assert = require("assert");
const { windowFrom } = require("../lib/providers/claude");
const { classifyWindow } = require("../lib/providers/codex");
const { bucketLabel, windowsForAccount } = require("../lib/providers/antigravity");

const claudeWindows = [
  windowFrom({ utilization: 25, resets_at: "2026-09-01T10:00:00Z" }, "five_hour", "5시간 한도"),
  windowFrom({ utilization: 40, resets_at: "2026-09-07T10:00:00Z" }, "seven_day", "주간 한도"),
].filter(Boolean);
assert.deepStrictEqual(claudeWindows.map((win) => win.label), ["5시간 한도", "주간 한도"]);
assert.deepStrictEqual(claudeWindows.map((win) => win.remainingPct), [75, 60]);

const codexWindows = [
  classifyWindow({ limit_window_seconds: 5 * 60 * 60, used_percent: 30, reset_after_seconds: 3600 }),
  classifyWindow({ limit_window_seconds: 7 * 24 * 60 * 60, used_percent: 45, reset_after_seconds: 7200 }),
].filter(Boolean);
assert.deepStrictEqual(codexWindows.map((win) => win.label), ["5시간 한도", "주간 한도"]);
assert.deepStrictEqual(codexWindows.map((win) => win.remainingPct), [70, 55]);

assert.strictEqual(bucketLabel("gemini-5h"), "Gemini 5시간 한도");
assert.strictEqual(bucketLabel("gemini-weekly"), "Gemini 주간 한도");
assert.strictEqual(bucketLabel("3p-5h"), "Claude/GPT 5시간 한도");
assert.strictEqual(bucketLabel("3p-weekly"), "Claude/GPT 주간 한도");

const antigravityWindows = windowsForAccount({
  id: "account-1",
  label: "ac***@example.com",
  observedAt: "2026-09-01T00:00:00Z",
  quota: {
    "gemini-5h": { remaining_fraction: 0.8, reset_in_seconds: 3600 },
    "gemini-weekly": { remaining_fraction: 0.6, reset_in_seconds: 86400 },
    "3p-5h": { remaining_fraction: 0.5, reset_in_seconds: 1800 },
    "3p-weekly": { remaining_fraction: 0.4, reset_in_seconds: 172800 },
  },
});
assert.strictEqual(antigravityWindows.length, 4);
assert.ok(antigravityWindows.some((win) => win.label.includes("Gemini 5시간 한도")));
assert.ok(antigravityWindows.some((win) => win.label.includes("Gemini 주간 한도")));
assert.ok(antigravityWindows.some((win) => win.label.includes("Claude/GPT 5시간 한도")));
assert.ok(antigravityWindows.some((win) => win.label.includes("Claude/GPT 주간 한도")));

console.log("five-hour and weekly quota window tests passed");
