const { spawn, execFileSync } = require("child_process");
const { home } = require("./paths");

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

function commandOutput(command, args) {
  try {
    return String(execFileSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }) || "");
  } catch {
    return "";
  }
}

function resolveCodexExecutable() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const output = process.platform === "win32"
    ? commandOutput("where.exe", ["codex"])
    : commandOutput("which", ["codex"]);
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function spawnAppServer(executable, spawnImpl = spawn, runtime = {}) {
  const options = {
    cwd: runtime.cwd || home(),
    env: runtime.env || process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    const comspec = process.env.ComSpec || "cmd.exe";
    const commandLine = `"${String(executable).replace(/"/g, '""')}" app-server`;
    return spawnImpl(comspec, ["/d", "/s", "/c", commandLine], options);
  }
  return spawnImpl(executable, ["app-server"], options);
}

function rpcLine(method, id, params) {
  const message = { method };
  if (id != null) message.id = id;
  if (params !== undefined) message.params = params;
  return `${JSON.stringify(message)}\n`;
}

function refreshManagedAuth(options = {}) {
  const executable = options.executable || resolveCodexExecutable();
  if (!executable) return Promise.resolve({ ok: false, reason: "codex-not-found" });
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl || spawn;
  const runtime = { env: options.env, cwd: options.cwd };

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

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    if (timer.unref) timer.unref();

    try {
      child = spawnAppServer(executable, spawnImpl, runtime);
    } catch (err) {
      finish({ ok: false, reason: "spawn-failed", error: err.message });
      return;
    }

    child.on("error", (err) => finish({ ok: false, reason: "spawn-failed", error: err.message }));
    child.on("exit", (code) => {
      if (!done) finish({ ok: false, reason: "early-exit", code, error: stderr.trim().slice(0, 300) });
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
          finish({ ok: false, reason: "initialize-error", error: message.error.message || String(message.error) });
          return;
        }
        if (initialized) return;
        initialized = true;
        child.stdin.write(rpcLine("initialized", null, {}));
        // Official stable API: force Codex to refresh its managed ChatGPT OAuth
        // token and persist the rotated credentials itself. No model turn is run.
        child.stdin.write(rpcLine("account/read", 1, { refreshToken: true }));
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish({ ok: false, reason: "refresh-error", error: message.error.message || String(message.error) });
          return;
        }
        const account = message.result && message.result.account;
        if (!account || account.type !== "chatgpt") {
          finish({ ok: false, reason: "not-chatgpt", account: account || null });
          return;
        }
        finish({ ok: true, account });
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        finish({ ok: false, reason: "output-limit" });
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
        version: "1.0.22",
      },
    }));
  });
}

module.exports = {
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  resolveCodexExecutable,
  spawnAppServer,
  rpcLine,
  refreshManagedAuth,
};
