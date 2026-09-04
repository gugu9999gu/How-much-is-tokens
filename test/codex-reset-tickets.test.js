const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const {
  normalizeResetTickets,
  readAccountRateLimits,
} = require("../lib/codex-rate-limits");
const {
  consumeAccountRateLimitResetCredit,
} = require("../lib/codex-reset-credit");
const {
  ticketExpiryText,
  resetTicketExtras,
} = require("../lib/providers/codex");

const now = 1_800_000_000_000;
const response = {
  rateLimits: { planType: "pro" },
  rateLimitResetCredits: {
    availableCount: 3,
    credits: [
      {
        id: "later",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: Math.floor((now - 86_400_000) / 1000),
        expiresAt: Math.floor((now + 10 * 86_400_000) / 1000),
        title: "Full reset (Weekly + 5 hr)",
      },
      {
        id: "sooner",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: Math.floor((now - 86_400_000) / 1000),
        expiresAt: Math.floor((now + 2 * 86_400_000) / 1000),
        title: "Full Reset",
      },
    ],
  },
};

const normalized = normalizeResetTickets(response, now);
assert.strictEqual(normalized.availableCount, 3, "availableCount is authoritative even when details are truncated");
assert.strictEqual(normalized.detailsProvided, true);
assert.strictEqual(normalized.detailsComplete, false);
assert.deepStrictEqual(normalized.tickets.map((ticket) => ticket.id), ["sooner", "later"]);
assert.strictEqual(normalized.nextExpiresAt, now + 2 * 86_400_000);
assert.strictEqual(normalized.tickets[0].resetType, "codexRateLimits");

const countOnly = normalizeResetTickets({
  rateLimitResetCredits: { availableCount: 2, credits: null },
}, now);
assert.strictEqual(countOnly.availableCount, 2);
assert.strictEqual(countOnly.detailsProvided, false);
assert.deepStrictEqual(countOnly.tickets, []);

const expiredFiltered = normalizeResetTickets({
  rateLimitResetCredits: {
    availableCount: 1,
    credits: [{
      id: "expired",
      resetType: "codexRateLimits",
      status: "available",
      grantedAt: Math.floor((now - 10_000) / 1000),
      expiresAt: Math.floor((now - 1_000) / 1000),
    }],
  },
}, now);
assert.deepStrictEqual(expiredFiltered.tickets, [], "expired detail rows must not be presented as valid tickets");
assert.strictEqual(expiredFiltered.availableCount, 1, "do not rewrite authoritative backend count");

assert.strictEqual(ticketExpiryText(now + 2 * 86_400_000, now), "D-2 · 2027-01-17");
assert.strictEqual(ticketExpiryText(null, now), "만료 없음");
const extras = resetTicketExtras(normalized, now);
assert.strictEqual(extras[0].label, "Codex/Work 리셋");
assert.strictEqual(extras[0].value, "3개");
assert.ok(extras[1].value.startsWith("D-2 · "));

function fakeReadSpawn() {
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
      if (msg.method === "account/rateLimits/read") {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(msg, "params"), false);
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: 1, result: response })}\n`));
      }
      if (msg.method === "account/rateLimitResetCredit/consume") {
        throw new Error("read path must never consume a reset ticket");
      }
      return true;
    },
    end() {},
  };
  return child;
}

function fakeConsumeSpawn() {
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
      if (msg.method === "account/rateLimitResetCredit/consume") {
        assert.deepStrictEqual(msg.params, {
          idempotencyKey: "idempotency-test-key",
          creditId: "sooner",
        });
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: 1, result: { outcome: "reset" } })}\n`));
      }
      if (msg.method === "account/rateLimits/read") {
        throw new Error("consume transport must not issue unrelated read requests");
      }
      return true;
    },
    end() {},
  };
  return child;
}

(async () => {
  const readResult = await readAccountRateLimits({
    executable: "codex-test-bin",
    spawnImpl: fakeReadSpawn,
    timeoutMs: 2_000,
  });
  assert.strictEqual(readResult.ok, true);
  assert.strictEqual(readResult.resetTickets.availableCount, 3);
  assert.strictEqual(readResult.response.rateLimits.planType, "pro");

  const consumeResult = await consumeAccountRateLimitResetCredit({
    executable: "codex-test-bin",
    spawnImpl: fakeConsumeSpawn,
    timeoutMs: 2_000,
    idempotencyKey: "idempotency-test-key",
    creditId: "sooner",
  });
  assert.strictEqual(consumeResult.ok, true);
  assert.strictEqual(consumeResult.outcome, "reset");
  assert.strictEqual(consumeResult.idempotencyKey, "idempotency-test-key");
  assert.strictEqual(consumeResult.creditId, "sooner");
  console.log("Codex banked reset ticket read/consume transport tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
