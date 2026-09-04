const { spawn } = require("child_process");
const {
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  resolveCodexExecutable,
  spawnAppServer,
  rpcLine,
} = require("./codex-app-server");

const READ_TIMEOUT_MS = 6_000;

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function unixSecondsToMs(value) {
  const seconds = finiteInteger(value);
  if (seconds == null || seconds <= 0) return null;
  return seconds * 1000;
}

function resetTypeLabel(resetType) {
  if (resetType === "codexRateLimits") return "Full Reset";
  return "Reset";
}

function normalizeResetTickets(response, now = Date.now()) {
  const summary = response && response.rateLimitResetCredits;
  if (!summary || typeof summary !== "object") return null;

  const availableCount = Math.max(0, finiteInteger(summary.availableCount) || 0);
  const detailsProvided = Array.isArray(summary.credits);
  const rawCredits = detailsProvided ? summary.credits : [];
  const tickets = rawCredits
    .filter((credit) => credit && typeof credit === "object")
    .map((credit) => {
      const expiresAt = unixSecondsToMs(credit.expiresAt);
      return {
        id: credit.id == null ? "" : String(credit.id),
        resetType: credit.resetType == null ? "unknown" : String(credit.resetType),
        status: credit.status == null ? "unknown" : String(credit.status),
        grantedAt: unixSecondsToMs(credit.grantedAt),
        expiresAt,
        title: credit.title == null || credit.title === "" ? resetTypeLabel(credit.resetType) : String(credit.title),
        description: credit.description == null ? null : String(credit.description),
        expired: expiresAt != null && expiresAt <= now,
      };
    })
    .filter((ticket) => ticket.status === "available" && !ticket.expired)
    .sort((a, b) => {
      if (a.expiresAt == null && b.expiresAt == null) return 0;
      if (a.expiresAt == null) return 1;
      if (b.expiresAt == null) return -1;
      return a.expiresAt - b.expiresAt;
    });

  const nextExpiresAt = tickets
    .map((ticket) => ticket.expiresAt)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0] || null;

  return {
    availableCount,
    detailsProvided,
    detailsComplete: detailsProvided && tickets.length >= availableCount,
    tickets,
    nextExpiresAt,
  };
}

function readAccountRateLimits(options = {}) {
  const executable = options.executable || resolveCodexExecutable();
  if (!executable) return Promise.resolve({ ok: false, reason: "codex-not-found" });
  const timeoutMs = Number(options.timeoutMs) || READ_TIMEOUT_MS || DEFAULT_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl || spawn;

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
      child = spawnAppServer(executable, spawnImpl);
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
        // This helper is strictly the read side. Automatic redemption lives in
        // codex-reset-credit.js and is guarded by the explicit opt-in policy.
        child.stdin.write(rpcLine("account/rateLimits/read", 1));
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish({ ok: false, reason: "rate-limits-error", error: message.error.message || String(message.error) });
          return;
        }
        const response = message.result || {};
        finish({
          ok: true,
          response,
          resetTickets: normalizeResetTickets(response),
        });
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
        version: "1.0.21",
      },
    }));
  });
}

module.exports = {
  READ_TIMEOUT_MS,
  unixSecondsToMs,
  resetTypeLabel,
  normalizeResetTickets,
  readAccountRateLimits,
};
