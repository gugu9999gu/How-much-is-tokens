// The legacy Claude Code Max 20x subscription is now called Ultra.
// Never infer a personal Ultra plan from a Team account's rate-limit tier.
const ULTRA_MAX_TIERS = new Set(["default_claude_max_20x", "claude_max_20x", "max_20x"]);
function normalizeClaudePlan(rawPlan, rawTier = null) {
  if (typeof rawPlan !== "string" || !rawPlan.trim()) return null;
  const plan = rawPlan.trim().toLowerCase().replace(/^claude[\s_-]+/, "").replace(/[\s_-]+/g, "");
  if (plan === "ultra" || plan === "max20x") return "Ultra";
  if (plan === "max5x") return "Max";
  if (plan === "max") return ULTRA_MAX_TIERS.has(String(rawTier || "").trim().toLowerCase()) ? "Ultra" : "Max";
  if (plan === "pro") return "Pro";
  if (plan === "free") return "Free";
  if (plan === "team") return "Team";
  if (plan === "enterprise") return "Enterprise";
  return null;
}
function planFromClaudeOauth(oauth) {
  if (!oauth || typeof oauth !== "object") return undefined;
  const raw = oauth.subscriptionType || oauth.rateLimitTier;
  return normalizeClaudePlan(oauth.subscriptionType, oauth.rateLimitTier) || normalizeClaudePlan(raw) || raw;
}
module.exports = { normalizeClaudePlan, planFromClaudeOauth };
