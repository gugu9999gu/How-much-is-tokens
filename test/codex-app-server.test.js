const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { rpcLine, refreshManagedAuth } = require("../lib/codex-app-server");

assert.deepStrictEqual(JSON.parse(rpcLine("account/read", 1, { refreshToken: true })), {
  method: "account/read",
  id: 1,
  params: { refreshToken: true },
});

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  child.stdin = {
    write(line) {
      const msg = JSON.parse(String(line).trim());
      if (msg.method === "initialize") {
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: 0, result: { userAgent: "codex-test" } })}\n`));
      }
      if (msg.method === "account/read") {
        assert.strictEqual(msg.params.refreshToken, true);
        setImmediate(() => child.stdout.write(`${JSON.stringify({
          id: 1,
          result: { account: { type: "chatgpt", planType: "pro" }, requiresOpenaiAuth: true },
        })}\n`));
      }
      return true;
    },
    end() {},
  };
  return child;
}

(async () => {
  const result = await refreshManagedAuth({
    executable: "codex-test-bin",
    spawnImpl: fakeSpawn,
    timeoutMs: 2_000,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.account.type, "chatgpt");
  assert.strictEqual(result.account.planType, "pro");
  console.log("Codex app-server managed auth refresh tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
