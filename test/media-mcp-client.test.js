const assert = require("assert");
const {
  selectBalanceTool,
  extractMcpUsage,
  normalizeToolName,
} = require("../lib/media-mcp-client");

assert.strictEqual(normalizeToolName("Get Credit Balance"), "get_credit_balance");
const tool = selectBalanceTool([
  { name: "create_video", inputSchema: { required: ["prompt"] } },
  { name: "balance", inputSchema: { type: "object", required: [] } },
], ["balance"]);
assert.strictEqual(tool.name, "balance");
assert.strictEqual(selectBalanceTool([
  { name: "balance", inputSchema: { required: ["workspace"] } },
], ["balance"]), null, "quota tool requiring unknown arguments must not be called automatically");

const higgs = extractMcpUsage({
  structuredContent: { credits: { balance: 42.5, total: 100 }, plan: "Creator" },
  content: [],
}, "higgsfield");
assert.strictEqual(higgs.balance, 42.5);
assert.strictEqual(higgs.limit, 100);
assert.strictEqual(higgs.remainingPct, 42.5);
assert.strictEqual(higgs.creditBalances[0].source, "mcp:higgsfield");

const eleven = extractMcpUsage({
  structuredContent: { tier: "creator", character_count: 25000, character_limit: 100000 },
  content: [],
}, "elevenlabs");
assert.strictEqual(eleven.balance, 75000);
assert.strictEqual(eleven.used, 25000);
assert.strictEqual(eleven.limit, 100000);
assert.strictEqual(eleven.remainingPct, 75);

const textOnly = extractMcpUsage({ content: [{ type: "text", text: "Remaining credits: 17.25 credits" }] }, "falai");
assert.strictEqual(textOnly.balance, 17.25);
assert.strictEqual(textOnly.creditBalances.length, 1);

console.log("media MCP parsing tests passed");
