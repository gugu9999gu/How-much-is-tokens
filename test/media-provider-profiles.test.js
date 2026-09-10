const assert = require("assert");
const {
  MEDIA_PROVIDER_IDS,
  normalizeMediaProviderProfiles,
  nextMediaProfile,
  mediaProfileInstanceKey,
  officialMcpFor,
} = require("../lib/media-provider-profiles");

assert.deepStrictEqual(MEDIA_PROVIDER_IDS, ["falai", "higgsfield", "magnific", "elevenlabs", "stability"]);
const profiles = normalizeMediaProviderProfiles([
  { providerId: "falai", id: "work", label: "Fal Work", mode: "mcp", priority: 20 },
  { providerId: "falai", id: "personal", label: "Fal Personal", mode: "api", priority: 10 },
  { providerId: "falai", id: "personal", label: "duplicate", priority: 1 },
  { providerId: "stability", id: "studio", label: "Studio", mode: "mcp" },
  { providerId: "unknown", id: "bad" },
]);
assert.deepStrictEqual(profiles.map((p) => `${p.providerId}:${p.id}:${p.mode}`), [
  "falai:personal:api",
  "falai:work:mcp",
  "stability:studio:mcp",
]);
assert.strictEqual(mediaProfileInstanceKey(profiles[0]), "falai:media:personal");
assert.strictEqual(officialMcpFor("falai").url, "https://mcp.fal.ai/mcp");
assert.strictEqual(officialMcpFor("falai").bearerField, "apiKey");
assert.strictEqual(officialMcpFor("higgsfield").auth, "oauth");
assert.strictEqual(officialMcpFor("stability"), null, "Stability must not claim an official MCP endpoint");

const next = nextMediaProfile({ mediaProviderProfiles: profiles }, "falai", { label: "Team Account", mode: "api" });
assert.strictEqual(next.id, "team-account");
assert.strictEqual(next.providerId, "falai");
assert.strictEqual(next.mode, "api");
assert.ok(next.priority > 0);

console.log("media provider profile tests passed");
