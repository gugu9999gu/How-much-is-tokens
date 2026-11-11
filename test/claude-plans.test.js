const assert = require("assert");
const { normalizeClaudePlan, planFromClaudeOauth } = require("../lib/claude-plans");
for (const value of ["Max 20x", "max_20x", "claude-max-20x", "ultra"]) {
  assert.strictEqual(normalizeClaudePlan(value), "Ultra");
}
for (const value of ["Max 5x", "max_5x", "max"]) {
  assert.strictEqual(normalizeClaudePlan(value), "Max");
}
assert.strictEqual(normalizeClaudePlan("pro"), "Pro");
assert.strictEqual(normalizeClaudePlan("claude_team"), "Team");
assert.strictEqual(normalizeClaudePlan("enterprise"), "Enterprise");
assert.strictEqual(normalizeClaudePlan("unknown"), null);
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "max", rateLimitTier: "default_claude_max_20x" }), "Ultra");
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "max", rateLimitTier: "default_claude_max_5x" }), "Max");
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "max" }), "Max");
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "team", rateLimitTier: "default_claude_max_20x" }), "Team");
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "pro", rateLimitTier: "default_claude_max_20x" }), "Pro");
assert.strictEqual(planFromClaudeOauth({ subscriptionType: "ultra" }), "Ultra");
assert.strictEqual(planFromClaudeOauth({ rateLimitTier: "default_claude_max_20x" }), "default_claude_max_20x",
  "tier without a subscription must not be interpreted as a personal Ultra subscription");
assert.strictEqual(planFromClaudeOauth(null), undefined);
console.log("Claude plan mapping tests passed");
