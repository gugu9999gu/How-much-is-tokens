const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ERROR_RETRY_MS,
  isActualRateLimitReached,
  resetFingerprint,
  selectCreditId,
  maybeAutoConsumeReset,
  readState,
} = require("../lib/codex-auto-reset");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "how-much-is-tokens-auto-reset-"));
const stateFile = path.join(dir, "automation-state.json");
const now = 1_800_000_000_000;

function reachedRead(options = {}) {
  const primaryReset = options.primaryReset ?? 1_800_010_000;
  const usedPercent = options.usedPercent ?? 100;
  const reachedType = options.reachedType === undefined ? "rate_limit_reached" : options.reachedType;
  return {
    ok: true,
    response: {
      rateLimits: {
        limitId: "codex",
        rateLimitReachedType: reachedType,
        primary: { usedPercent, resetsAt: primaryReset },
        secondary: { usedPercent: 88, resetsAt: 1_800_500_000 },
      },
    },
    resetTickets: {
      availableCount: options.availableCount ?? 2,
      tickets: options.tickets || [
        { id: "later", status: "available", expiresAt: now + 10 * 86_400_000 },
        { id: "sooner", status: "available", expiresAt: now + 2 * 86_400_000 },
      ],
    },
  };
}

assert.strictEqual(isActualRateLimitReached(reachedRead().response), true);
assert.strictEqual(isActualRateLimitReached(reachedRead({ reachedType: null }).response), false);
assert.strictEqual(selectCreditId(reachedRead().resetTickets), "sooner", "earliest-expiring credit must be selected");

const fingerprint100 = resetFingerprint(reachedRead({ usedPercent: 100 }).response);
const fingerprint99 = resetFingerprint(reachedRead({ usedPercent: 99 }).response);
assert.strictEqual(fingerprint100, fingerprint99, "percent fluctuations must not create a new limit epoch");
assert.notStrictEqual(
  fingerprint100,
  resetFingerprint(reachedRead({ primaryReset: 1_800_020_000 }).response),
  "a new reset boundary must create a new epoch",
);

(async () => {
  let calls = [];
  const consume = async (params) => {
    calls.push(params);
    return { ok: true, outcome: "reset", ...params };
  };

  const disabled = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: false },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead(),
    now,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(disabled.reason, "disabled");
  assert.strictEqual(calls.length, 0);

  const roundedZeroOnly = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead({ reachedType: null, usedPercent: 100 }),
    now,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(roundedZeroOnly.reason, "not-rate-limit-reached");
  assert.strictEqual(calls.length, 0, "100% used without server reached state must never spend a reset");

  const noCredit = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead({ availableCount: 0, tickets: [] }),
    now,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(noCredit.reason, "no-credit");
  assert.strictEqual(calls.length, 0);

  const first = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead(),
    now,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(first.attempted, true);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.outcome, "reset");
  assert.strictEqual(first.creditId, "sooner");
  assert.ok(first.idempotencyKey);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].creditId, "sooner");

  const persisted = readState(stateFile).codexAutoReset["codex:a"];
  assert.strictEqual(persisted.outcome, "reset");
  assert.strictEqual(persisted.creditId, "sooner");
  assert.strictEqual(persisted.idempotencyKey, first.idempotencyKey);

  const repeatSameEpoch = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead({ usedPercent: 99 }),
    now: now + 60_000,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(repeatSameEpoch.reason, "already-attempted");
  assert.strictEqual(calls.length, 1, "same limit epoch must not spend a second ticket");

  const nextEpoch = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:a",
    rateLimitsRead: reachedRead({ primaryReset: 1_800_020_000 }),
    now: now + 120_000,
    filePath: stateFile,
    consumeImpl: consume,
  });
  assert.strictEqual(nextEpoch.attempted, true);
  assert.strictEqual(calls.length, 2, "a genuinely new limit epoch may consume another reset");
  assert.notStrictEqual(nextEpoch.idempotencyKey, first.idempotencyKey);

  // A retryable transport failure reuses the same idempotency key after the
  // cooldown so an uncertain first request cannot double-redeem a ticket.
  const retryFile = path.join(dir, "retry-state.json");
  const retryCalls = [];
  const failOnce = async (params) => {
    retryCalls.push(params);
    return retryCalls.length === 1
      ? { ok: false, reason: "timeout", ...params }
      : { ok: true, outcome: "alreadyRedeemed", ...params };
  };
  const failed = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:retry",
    rateLimitsRead: reachedRead(),
    now,
    filePath: retryFile,
    consumeImpl: failOnce,
  });
  assert.strictEqual(failed.outcome, "timeout");

  const tooSoon = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:retry",
    rateLimitsRead: reachedRead(),
    now: now + ERROR_RETRY_MS - 1,
    filePath: retryFile,
    consumeImpl: failOnce,
  });
  assert.strictEqual(tooSoon.reason, "already-attempted");
  assert.strictEqual(retryCalls.length, 1);

  const retried = await maybeAutoConsumeReset({
    settings: { codexAutoUseReset: true },
    accountKey: "codex:retry",
    rateLimitsRead: reachedRead(),
    now: now + ERROR_RETRY_MS + 1,
    filePath: retryFile,
    consumeImpl: failOnce,
  });
  assert.strictEqual(retried.ok, true);
  assert.strictEqual(retried.outcome, "alreadyRedeemed");
  assert.strictEqual(retryCalls.length, 2);
  assert.strictEqual(retryCalls[0].idempotencyKey, retryCalls[1].idempotencyKey);

  // Automation state contains only account aliases / opaque reset metadata,
  // never OAuth access or refresh tokens.
  const stateText = fs.readFileSync(stateFile, "utf8");
  assert.ok(!/access[_-]?token|refresh[_-]?token/i.test(stateText));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Codex automatic reset safety tests passed");
})().catch((err) => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.error(err);
  process.exitCode = 1;
});
