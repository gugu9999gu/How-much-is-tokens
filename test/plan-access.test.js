const assert = require("assert");
const { planRenewalFromWindows, withPlanRenewal } = require("../lib/plan-access");

const fiveHour = Date.parse("2026-09-23T11:20:00Z");
const weekly = Date.parse("2026-09-24T23:00:00Z");
const laterWeekly = Date.parse("2026-09-30T07:27:41Z");

const claude = planRenewalFromWindows([
  { id: "five_hour", label: "5시간 한도", resetAt: fiveHour },
  { id: "weekly-all", label: "주간 한도", resetAt: weekly },
]);
assert.ok(claude);
assert.strictEqual(claude.renewsAt, weekly, "weekly plan renewal must win over the five-hour window");
assert.strictEqual(claude.windowLabel, "주간 한도");

const codex = planRenewalFromWindows([
  { id: "weekly", label: "주간 한도", resetAt: laterWeekly },
]);
assert.strictEqual(codex.renewsAt, laterWeekly);

assert.strictEqual(planRenewalFromWindows([
  { id: "session", label: "5시간 한도", resetAt: fiveHour },
]), null, "a five-hour window is not a plan renewal date");

const agy = planRenewalFromWindows([
  { id: "gemini-weekly", label: "Gemini 주간 한도", resetAt: weekly },
  { id: "3p-5h", label: "Claude/GPT 5시간 한도", resetAt: fiveHour },
  { id: "3p-weekly", label: "Claude/GPT 주간 한도", resetAt: laterWeekly },
]);
assert.strictEqual(agy.renewsAt, weekly, "the soonest weekly renewal is the next plan boundary");
assert.strictEqual(agy.windowLabel, "Gemini 주간 한도");

const billed = withPlanRenewal({
  billing: { renewsAt: weekly, label: "결제일" },
  windows: [{ id: "weekly", label: "주간 한도", resetAt: laterWeekly }],
});
assert.strictEqual(billed.accessRenewal, undefined, "a real billing date must not be replaced");

const uncovered = withPlanRenewal({
  windows: [{ id: "weekly", label: "주간 한도", resetAt: laterWeekly }],
});
assert.strictEqual(uncovered.accessRenewal.renewsAt, laterWeekly);

console.log("plan renewal date tests passed");
