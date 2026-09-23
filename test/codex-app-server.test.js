const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { rpcLine, refreshManagedAuth, nativeCodexExecutable } = require("../lib/codex-app-server");

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-shim-"));
const shim = path.join(shimDir, "codex.cmd");
const nativeExe = path.join(
  shimDir,
  "node_modules",
  "@openai",
  "codex",
  "node_modules",
  "@openai",
  "codex-win32-x64",
  "vendor",
  "x86_64-pc-windows-msvc",
  "bin",
  "codex.exe",
);
fs.mkdirSync(path.dirname(nativeExe), { recursive: true });
fs.writeFileSync(shim, "@echo off\r\n");
fs.writeFileSync(nativeExe, "");
assert.strictEqual(nativeCodexExecutable(shim, "win32", "x64"), nativeExe, "npm codex.cmd must resolve to the native app-server executable");
assert.strictEqual(nativeCodexExecutable(shim, "linux", "x64"), null);

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
