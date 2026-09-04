const assert = require("assert");
const {
  creditSnapshotFromRateLimits,
  creditBalances,
} = require("../lib/providers/codex");

const resetSeconds = 1_800_500_000;
const rateLimitsRead = {
  ok: true,
  response: {
    rateLimits: {
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "17.5",
      },
      individualLimit: {
        limit: "100",
        used: "25",
        remainingPercent: 75,
        resetsAt: resetSeconds,
      },
    },
  },
};

const balances = creditSnapshotFromRateLimits(rateLimitsRead);
assert.strictEqual(balances.length, 2);
assert.strictEqual(balances[0].label, "보유 크레딧");
assert.strictEqual(balances[0].balance, 17.5);
assert.strictEqual(balances[0].unit, "크레딧");
assert.strictEqual(balances[0].unlimited, false);
assert.strictEqual(balances[1].label, "월간 크레딧 한도");
assert.strictEqual(balances[1].limit, 100);
assert.strictEqual(balances[1].used, 25);
assert.strictEqual(balances[1].balance, 75);
assert.strictEqual(balances[1].remainingPct, 75);
assert.strictEqual(balances[1].resetAt, resetSeconds * 1000);

const unlimited = creditSnapshotFromRateLimits({
  ok: true,
  response: {
    rateLimits: {
      credits: { hasCredits: true, unlimited: true, balance: null },
    },
  },
});
assert.strictEqual(unlimited.length, 1);
assert.strictEqual(unlimited[0].unlimited, true);
assert.strictEqual(unlimited[0].balance, null);

const whamFallback = creditBalances({ credits: { balance: "9.25" } }, { ok: false });
assert.strictEqual(whamFallback.length, 1);
assert.strictEqual(whamFallback[0].balance, 9.25);
assert.strictEqual(whamFallback[0].label, "보유 크레딧");

const noCredits = creditBalances({}, { ok: true, response: { rateLimits: { credits: { hasCredits: false, unlimited: false, balance: null } } } });
assert.deepStrictEqual(noCredits, [], "Codex must not fabricate credit balances when the backend reports none");

console.log("Codex owned / monthly credit balance tests passed");
