const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const {
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  resolveCodexExecutable,
  spawnAppServer,
  rpcLine,
} = require("./codex-app-server");

const CONSUME_TIMEOUT_MS = 6_000;
const SUCCESS_OUTCOMES = new Set(["reset", "alreadyRedeemed"]);

function consumeAccountRateLimitResetCredit(options = {}) {
  const executable = options.executable || resolveCodexExecutable();
  if (!executable) return Promise.resolve({ ok: false, reason: "codex-not-found" });
  const timeoutMs = Number(options.timeoutMs) || CONSUME_TIMEOUT_MS || DEFAULT_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl || spawn;
  const idempotencyKey = String(options.idempotencyKey || randomUUID()).trim();
  const creditId = options.creditId == null ? null : String(options.creditId).trim();
  if (!idempotencyKey) return Promise.resolve({ ok: false, reason: "missing-idempotency-key" });

  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let done = false;
    let initialized = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch {}
      try {
        const killer = setTimeout(() => {
          try { child?.kill(); } catch {}
        }, 100);
        if (killer.unref) killer.unref();
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout", idempotencyKey, creditId }), timeoutMs);
    if (timer.unref) timer.unref();

    try {
      child = spawnAppServer(executable, spawnImpl);
    } catch (err) {
      finish({ ok: false, reason: "spawn-failed", error: err.message, idempotencyKey, creditId });
      return;
    }

    child.on("error", (err) => finish({ ok: false, reason: "spawn-failed", error: err.message, idempotencyKey, creditId }));
    child.on("exit", (code) => {
      if (!done) finish({ ok: false, reason: "early-exit", code, error: stderr.trim().slice(0, 300), idempotencyKey, creditId });
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES) stderr = stderr.slice(-MAX_OUTPUT_BYTES / 2);
    });

    const consumeLine = (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }

      if (message.id === 0) {
        if (message.error) {
          finish({ ok: false, reason: "initialize-error", error: message.error.message || String(message.error), idempotencyKey, creditId });
          return;
        }
        if (initialized) return;
        initialized = true;
        child.stdin.write(rpcLine("initialized", null, {}));
        const params = { idempotencyKey };
        if (creditId) params.creditId = creditId;
        child.stdin.write(rpcLine("account/rateLimitResetCredit/consume", 1, params));
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish({ ok: false, reason: "consume-error", error: message.error.message || String(message.error), idempotencyKey, creditId });
          return;
        }
        const outcome = message.result && message.result.outcome ? String(message.result.outcome) : "unknown";
        finish({
          ok: SUCCESS_OUTCOMES.has(outcome),
          outcome,
          idempotencyKey,
          creditId,
        });
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        finish({ ok: false, reason: "output-limit", idempotencyKey, creditId });
        return;
      }
      while (true) {
        const index = stdout.indexOf("\n");
        if (index < 0) break;
        const line = stdout.slice(0, index).replace(/\r$/, "");
        stdout = stdout.slice(index + 1);
        consumeLine(line);
      }
    });

    child.stdin.write(rpcLine("initialize", 0, {
      clientInfo: {
        name: "how_much_is_tokens",
        title: "How much is tokens",
        version: "1.0.21",
      },
    }));
  });
}

module.exports = {
  CONSUME_TIMEOUT_MS,
  SUCCESS_OUTCOMES,
  consumeAccountRateLimitResetCredit,
};
