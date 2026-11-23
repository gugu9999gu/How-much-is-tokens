const assert = require("assert");
const { bucketLabel, windowsForAccount } = require("../lib/providers/antigravity");
const { commandForBridge, launcherScript, LAUNCHER_MARKER } = require("../lib/antigravity-bridge");

assert.strictEqual(bucketLabel("gemini-weekly"), "Gemini 주간 한도");
assert.strictEqual(bucketLabel("3p-5h"), "Claude/GPT 5시간 한도");
assert.strictEqual(bucketLabel("gemini-argon-wtu-weekly"), "Gemini 4 Argon 주간 한도");
assert.strictEqual(bucketLabel("gemini-4-argon-5h"), "Gemini 4 Argon 5시간 한도");

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

const statusCommand = commandForBridge();
assert.match(statusCommand, /^cmd\.exe \/d \/c /);
assert.ok(statusCommand.includes(LAUNCHER_MARKER));
assert.ok(!statusCommand.includes("-File \""), "Antigravity command must not contain a quoted PowerShell -File path");
assert.match(launcherScript(), /powershell\.exe .* -File "/);


const independentModels = windowsForAccount({
  id: "abc123",
  label: "de***@gmail.com",
  observedAt: "2026-11-23T00:00:00Z",
  quota: {
    "gemini-weekly": { remaining_fraction: 0.8 },
    "gemini-argon-wtu-weekly": { remaining_fraction: 0.22 },
  },
});
assert.strictEqual(independentModels.length, 2);
assert.ok(independentModels.some((win) => win.label.includes("Gemini 4 Argon 주간 한도") && win.remainingPct === 22));

console.log("antigravity provider and bridge tests passed");
