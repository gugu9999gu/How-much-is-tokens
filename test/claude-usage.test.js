const assert = require("assert");
const { requestJson } = require("../lib/http");
const {
  fetchUsage,
  credentialsPath,
  claudeConfigPath,
  cachedUsageSnapshot,
  clearRetryBackoffForTests,
  structuredWindows,
  allUsageWindows,
  extraUsageCreditBalance,
  spendCreditBalance,
  creditBalances,
} = require("../lib/providers/claude");

const reset = "2026-09-11T00:00:00Z";
const structuredFixture = {
  limits: [
    {
      kind: "session",
      percent: 10,
      resets_at: "2026-09-04T15:00:00Z",
    },
    {
      kind: "weekly_all",
      percent: 20,
      resets_at: reset,
    },
    {
      kind: "weekly_scoped",
      percent: 30,
      resets_at: reset,
      scope: { model: { display_name: "Fable" } },
    },
    {
      kind: "weekly_scoped",
      percent: 40,
      resets_at: reset,
      scope: { model: { display_name: "Future Model" } },
    },
  ],
};

const structured = structuredWindows(structuredFixture);
assert.deepStrictEqual(structured.map((win) => win.label), [
  "세션 한도",
  "주간 한도",
  "Fable 주간 한도",
  "Future Model 주간 한도",
]);
assert.strictEqual(structured.find((win) => win.label === "Fable 주간 한도").remainingPct, 70);
assert.strictEqual(structured.find((win) => win.label === "Future Model 주간 한도").remainingPct, 60);
assert.ok(structured.every((win) => win.source === "claude-oauth-limits"));

const all = allUsageWindows({
  ...structuredFixture,
  five_hour: { utilization: 10, resets_at: "2026-09-04T15:00:00Z" },
  seven_day: { utilization: 20, resets_at: reset },
  seven_day_fable: { utilization: 30, resets_at: reset },
});
assert.strictEqual(all.filter((win) => /Fable/.test(win.label)).length, 1, "structured + flat Fable rows must deduplicate");
assert.strictEqual(all.filter((win) => win.label === "주간 한도").length, 1, "weekly compatibility row must deduplicate");
assert.strictEqual(all.filter((win) => /세션|5시간/.test(win.label)).length, 1, "session compatibility row must deduplicate");

const noFable = allUsageWindows({
  limits: [
    { kind: "session", percent: 15, resets_at: reset },
    { kind: "weekly_all", percent: 25, resets_at: reset },
  ],
});
assert.ok(!noFable.some((win) => /fable/i.test(win.id) || /fable/i.test(win.label)), "Fable quota must never be fabricated");

// Current clients can expose the same Fable meter through this known flat
// compatibility key. It is explicitly mapped; arbitrary seven_day_* codenames
// must not be guessed as model names.
const legacyFable = allUsageWindows({
  seven_day_overage_included: {
    utilization: 12,
    resets_at: reset,
  },
  seven_day_omelette: {
    utilization: 99,
    resets_at: reset,
  },
});
assert.strictEqual(legacyFable.length, 1);
assert.strictEqual(legacyFable[0].label, "Fable 주간 한도");
assert.strictEqual(legacyFable[0].remainingPct, 88);

const extra = extraUsageCreditBalance({
  is_enabled: true,
  monthly_limit: 5000,
  used_credits: 1250,
  utilization: 25,
  currency: "usd",
  decimal_places: 2,
  resets_at: "2026-10-01T00:00:00Z",
});
assert.ok(extra);
assert.strictEqual(extra.label, "Usage Credits");
assert.strictEqual(extra.limit, 50);
assert.strictEqual(extra.used, 12.5);
assert.strictEqual(extra.balance, 37.5);
assert.strictEqual(extra.remainingPct, 75);
assert.strictEqual(extra.currency, "USD");

const spend = spendCreditBalance({
  used: { amount_minor: 1234, exponent: 2 },
  limit: { amount_minor: 5000, exponent: 2 },
  balance: { amount_minor: 3766, exponent: 2 },
  percent: 24.68,
  currency: "usd",
  resets_at: "2026-10-01T00:00:00Z",
});
assert.ok(spend);
assert.strictEqual(spend.used, 12.34);
assert.strictEqual(spend.limit, 50);
assert.strictEqual(spend.balance, 37.66);
assert.ok(Math.abs(spend.remainingPct - 75.32) < 0.001);

const preferred = creditBalances({
  spend: {
    used: { amount_minor: 100, exponent: 2 },
    limit: { amount_minor: 2000, exponent: 2 },
    balance: { amount_minor: 1900, exponent: 2 },
    currency: "usd",
  },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 9000,
    used_credits: 1000,
  },
});
assert.strictEqual(preferred.length, 1, "spend and extra_usage must not double-count the same credit pool");
assert.strictEqual(preferred[0].balance, 19);

const cacheNow = Date.parse("2026-09-21T00:40:00Z");
const cachedFixture = {
  limits: structuredFixture.limits.map((limit) => ({
    ...limit,
    resets_at: "2026-09-25T00:00:00Z",
  })),
};
const cachedUtilization = {
  fetchedAtMs: cacheNow - 60_000,
  accountUuid: "account-a",
  utilization: cachedFixture,
};

assert.strictEqual(
  claudeConfigPath({ configDir: "C:\\claude-profile" }, () => true),
  "C:\\claude-profile\\.config.json",
);
assert.strictEqual(
  claudeConfigPath({ configDir: "C:\\claude-profile" }, () => false),
  "C:\\claude-profile\\.claude.json",
);

const cached = cachedUsageSnapshot(
  { cachedUsageUtilization: cachedUtilization },
  { accountUuid: "account-a" },
  cacheNow,
);
assert.ok(cached && cached.fresh, "matching Claude Code cache should be accepted for one hour");
assert.strictEqual(cached.data, cachedFixture);
assert.ok(
  cachedUsageSnapshot(
    {
      oauthAccount: { accountUuid: "account-a" },
      cachedUsageUtilization: cachedUtilization,
    },
    { accessToken: "fixture" },
    cacheNow,
  ),
  "current Claude credentials may keep the account UUID in the global config",
);
assert.strictEqual(
  cachedUsageSnapshot(
    { cachedUsageUtilization: cachedUtilization },
    { accountUuid: "account-b" },
    cacheNow,
  ),
  null,
  "another account's Claude Code cache must never be reused",
);

async function runFetchTests() {
  const profile = { configDir: "C:\\claude-profile" };
  const credentialFile = credentialsPath(profile);
  const oauth = {
    accessToken: "fixture",
    accountUuid: "account-a",
    subscriptionType: "max",
  };
  const freshConfig = { cachedUsageUtilization: cachedUtilization };
  let calls = 0;
  const readJson = (file) => file === credentialFile ? { claudeAiOauth: oauth } : freshConfig;
  const fromCache = await fetchUsage({}, {}, profile, {
    now: () => cacheNow,
    existsSync: () => false,
    readJson,
    requestJson: async () => {
      calls += 1;
      return { ok: false, status: 500, json: null, headers: {} };
    },
  });
  assert.strictEqual(calls, 0, "fresh Claude Code usage cache should avoid the rate-limited endpoint");
  assert.strictEqual(fromCache.status, "ok");
  assert.strictEqual(fromCache.remainingPct, 90);
  assert.strictEqual(fromCache.cacheSource, "claude-code");

  clearRetryBackoffForTests();
  calls = 0;
  const liveRequest = async () => {
    calls += 1;
    return { ok: true, status: 200, json: cachedFixture, headers: {} };
  };
  const withoutLocalCache = (file) => file === credentialFile ? { claudeAiOauth: oauth } : {};
  const live = await fetchUsage({}, {}, profile, {
    now: () => cacheNow,
    existsSync: () => false,
    readJson: withoutLocalCache,
    requestJson: liveRequest,
  });
  assert.strictEqual(live.status, "ok");
  assert.strictEqual(calls, 1);
  const fromMemory = await fetchUsage({}, {}, profile, {
    now: () => cacheNow + 60_000,
    existsSync: () => false,
    readJson: withoutLocalCache,
    requestJson: liveRequest,
  });
  assert.strictEqual(fromMemory.cacheSource, "widget-memory");
  assert.strictEqual(calls, 1, "a successful endpoint response should be reused instead of polling every minute");

  clearRetryBackoffForTests();
  const staleConfig = {
    cachedUsageUtilization: {
      ...cachedUtilization,
      fetchedAtMs: cacheNow - (2 * 60 * 60 * 1000),
    },
  };
  calls = 0;
  const rateLimitedRequest = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      json: { error: { type: "rate_limit_error" } },
      headers: { "retry-after": "120" },
    };
  };
  const rateLimited = await fetchUsage({}, {}, profile, {
    now: () => cacheNow,
    existsSync: () => false,
    readJson: (file) => file === credentialFile ? { claudeAiOauth: oauth } : staleConfig,
    requestJson: rateLimitedRequest,
  });
  assert.strictEqual(rateLimited.status, "ok", "429 should fall back to the matching Claude Code cache");
  assert.strictEqual(rateLimited.stale, true);
  assert.strictEqual(calls, 1);

  const duringBackoff = await fetchUsage({}, {}, profile, {
    now: () => cacheNow + 60_000,
    existsSync: () => false,
    readJson: (file) => file === credentialFile ? { claudeAiOauth: oauth } : staleConfig,
    requestJson: rateLimitedRequest,
  });
  assert.strictEqual(duringBackoff.status, "ok");
  assert.strictEqual(duringBackoff.stale, true);
  assert.strictEqual(calls, 1, "Retry-After should suppress another endpoint call during backoff");

  const originalFetch = global.fetch;
  try {
    global.fetch = async () => new Response("{}", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
    const response = await requestJson("https://example.invalid/usage");
    assert.strictEqual(response.headers["retry-after"], "120", "HTTP helper should preserve Retry-After");
  } finally {
    global.fetch = originalFetch;
  }
}

runFetchTests().then(() => {
  console.log("Claude scoped quota / Fable / usage credit / cache fallback tests passed");
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
