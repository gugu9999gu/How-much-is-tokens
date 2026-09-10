const assert = require("assert");
const {
  DEFAULT_ROUTER_PORT,
  MAX_PROFILES,
  cleanProfileId,
  normalizeOpenRouterProfiles,
  activeOpenRouterProfiles,
  normalizeOpenRouterRouter,
  defaultOpenRouterProfile,
  slugProfileId,
  nextOpenRouterProfileId,
  nextOpenRouterPriority,
  createOpenRouterProfile,
} = require("../lib/openrouter-profiles");

assert.strictEqual(cleanProfileId(" Primary_1 "), "primary_1");
assert.strictEqual(cleanProfileId("bad space"), null);
assert.strictEqual(cleanProfileId("-bad"), null);
assert.strictEqual(cleanProfileId("a".repeat(33)), null);
assert.strictEqual(slugProfileId(" Work Key 01 "), "work-key-01");
assert.strictEqual(slugProfileId("업무용 키"), null);

const profiles = normalizeOpenRouterProfiles([
  { id: "backup", label: " 백업\n키 ", priority: 20 },
  { id: "primary", label: "주 키", priority: 10 },
  { id: "backup", label: "중복", priority: 1 },
  { id: "disabled", label: "꺼짐", priority: 5, enabled: false },
  { id: "bad space", label: "invalid", priority: 0 },
]);
assert.deepStrictEqual(profiles.map((profile) => profile.id), ["disabled", "primary", "backup"]);
assert.strictEqual(profiles.find((profile) => profile.id === "backup").label, "백업 키");
assert.strictEqual(profiles.find((profile) => profile.id === "backup").priority, 20);
assert.deepStrictEqual(activeOpenRouterProfiles({ openRouterProfiles: profiles }).map((profile) => profile.id), ["primary", "backup"]);

assert.deepStrictEqual(normalizeOpenRouterRouter(), {
  enabled: false,
  port: DEFAULT_ROUTER_PORT,
  policy: "priority-fallback",
});
assert.deepStrictEqual(normalizeOpenRouterRouter({ enabled: true, port: 65535, policy: "max-remaining" }), {
  enabled: true,
  port: 65535,
  policy: "max-remaining",
});
assert.strictEqual(normalizeOpenRouterRouter({ port: 1 }).port, DEFAULT_ROUTER_PORT);
assert.strictEqual(normalizeOpenRouterRouter({ policy: "unknown" }).policy, "priority-fallback");
assert.strictEqual(defaultOpenRouterProfile().id, "default");
assert.strictEqual(defaultOpenRouterProfile().priority, 10);

assert.strictEqual(nextOpenRouterProfileId([], "개인"), "default");
assert.strictEqual(nextOpenRouterProfileId([{ id: "default", priority: 10 }], "Work Key"), "work-key");
assert.strictEqual(nextOpenRouterProfileId([
  { id: "default", priority: 10 },
  { id: "work-key", priority: 20 },
], "Work Key"), "key-3");
assert.strictEqual(nextOpenRouterPriority([
  { id: "default", priority: 10 },
  { id: "backup", priority: 40 },
]), 50);

const firstQuick = createOpenRouterProfile([], { label: "개인" });
assert.deepStrictEqual(firstQuick, {
  id: "default",
  providerId: "openrouter",
  label: "개인",
  priority: 10,
  enabled: true,
});
const secondQuick = createOpenRouterProfile([firstQuick], { label: "Work Key" });
assert.strictEqual(secondQuick.id, "work-key");
assert.strictEqual(secondQuick.priority, 20);
assert.strictEqual(secondQuick.enabled, true);

const tooMany = normalizeOpenRouterProfiles(Array.from({ length: 20 }, (_, index) => ({
  id: `profile_${index}`,
  priority: index,
})));
assert.strictEqual(tooMany.length, MAX_PROFILES);
assert.strictEqual(createOpenRouterProfile(tooMany, { label: "too many" }), null);

console.log("OpenRouter profile model tests passed");
