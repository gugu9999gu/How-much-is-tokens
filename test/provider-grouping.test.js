const assert = require("assert");
const { providerMeta, sortProviders } = require("../lib/usage");

assert.strictEqual(providerMeta("codex").vendor, "OpenAI");
assert.strictEqual(providerMeta("claude").vendor, "Anthropic");
assert.strictEqual(providerMeta("antigravity").vendor, "Google");
assert.strictEqual(providerMeta("grok").vendor, "xAI");
assert.strictEqual(providerMeta("grokbot").vendor, "xAI");
assert.strictEqual(providerMeta("cursor").vendor, "Cursor");
assert.strictEqual(providerMeta("copilot").vendor, "GitHub");
assert.strictEqual(providerMeta("unknown").vendor, "기타");

const ids = ["copilot", "grokbot", "cursor", "claude", "antigravity", "grok", "codex", "unknown"];
const sorted = sortProviders(ids.map((id) => ({ id, name: id, ...providerMeta(id) })));
assert.deepStrictEqual(
  sorted.map((provider) => provider.id),
  ["codex", "claude", "antigravity", "grok", "grokbot", "cursor", "copilot", "unknown"],
);

console.log("provider grouping tests passed");
