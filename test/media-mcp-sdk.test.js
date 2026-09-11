const assert = require("assert");

(async () => {
  const sdk = await import("@modelcontextprotocol/client");
  assert.strictEqual(typeof sdk.Client, "function", "MCP v2 client export must be available at runtime");
  assert.strictEqual(typeof sdk.StreamableHTTPClientTransport, "function", "Streamable HTTP transport export must be available at runtime");
  assert.strictEqual(typeof sdk.UnauthorizedError, "function", "OAuth unauthorized sentinel must be available at runtime");
  console.log("pinned MCP client runtime export test passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
