const assert = require("assert");
const {
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
  "5시간 한도",
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

console.log("Claude scoped quota / Fable / usage credit tests passed");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { clearClaudeFactCache } = require("../lib/claude-reset-credits");
const {
  OAUTH_CLIENT_ID,
  OAUTH_TOKEN_URL,
  canRefresh,
  ensureClaudeAuth,
  fetchUsage,
  isFreshAccess,
} = require("../lib/providers/claude");

function writeCreds(file, oauth, extra = {}) {
  fs.writeFileSync(file, JSON.stringify({ mcpOAuth: { keep: true }, ...extra, claudeAiOauth: oauth }, null, 2));
}

const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-auth-"));
const credFile = path.join(authDir, ".credentials.json");
const now = Date.parse("2026-09-27T03:00:00.000Z");
const expiredOauth = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: Date.parse("2026-09-27T00:00:00.000Z"),
  refreshTokenExpiresAt: Date.parse("2026-10-24T00:00:00.000Z"),
  scopes: ["user:profile"],
  subscriptionType: "pro",
  rateLimitTier: "default_claude_ai",
};

assert.strictEqual(isFreshAccess(expiredOauth, now), false, "expired Claude access token must not be reused");
assert.strictEqual(canRefresh(expiredOauth, now), true);
assert.strictEqual(canRefresh({
  ...expiredOauth,
  refreshTokenExpiresAt: Date.parse("2026-09-26T00:00:00.000Z"),
}, now), false, "expired refresh token must not be posted");

(async () => {
  clearClaudeFactCache();
  writeCreds(credFile, expiredOauth);
  let tokenPosts = 0;
  const refreshed = await ensureClaudeAuth(null, {
    credentialsFile: credFile,
    now,
    requestJson: async (url, init) => {
      assert.strictEqual(url, OAUTH_TOKEN_URL);
      const body = JSON.parse(init.body);
      assert.strictEqual(body.grant_type, "refresh_token");
      assert.strictEqual(body.refresh_token, "old-refresh");
      assert.strictEqual(body.client_id, OAUTH_CLIENT_ID);
      assert.strictEqual(body.scope, "user:profile");
      tokenPosts += 1;
      return {
        ok: true,
        status: 200,
        json: {
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 28800,
          refresh_token_expires_in: 2592000,
          scope: "user:profile user:inference",
        },
      };
    },
  });
  assert.strictEqual(refreshed.token, "new-access");
  assert.strictEqual(tokenPosts, 1);
  const stored = JSON.parse(fs.readFileSync(credFile, "utf8"));
  assert.strictEqual(stored.mcpOAuth.keep, true, "refresh must keep unrelated credential keys");
  assert.strictEqual(stored.claudeAiOauth.accessToken, "new-access");
  assert.strictEqual(stored.claudeAiOauth.refreshToken, "new-refresh");
  assert.strictEqual(stored.claudeAiOauth.expiresAt, now + 28800 * 1000);
  assert.strictEqual(stored.claudeAiOauth.refreshTokenExpiresAt, now + 2592000 * 1000);
  assert.deepStrictEqual(stored.claudeAiOauth.scopes, ["user:profile", "user:inference"]);
  assert.strictEqual(stored.claudeAiOauth.subscriptionType, "pro");

  const failedFile = path.join(authDir, "failed.json");
  writeCreds(failedFile, expiredOauth);
  const failed = await ensureClaudeAuth(null, {
    credentialsFile: failedFile,
    now,
    requestJson: async () => ({ ok: false, status: 400, json: { error: "invalid_grant" } }),
  });
  assert.strictEqual(failed, null, "rejected refresh must not invent an access token");
  assert.strictEqual(JSON.parse(fs.readFileSync(failedFile, "utf8")).claudeAiOauth.refreshToken, "old-refresh");

  const racedFile = path.join(authDir, "raced.json");
  writeCreds(racedFile, expiredOauth);
  const raced = await ensureClaudeAuth(null, {
    credentialsFile: racedFile,
    now,
    requestJson: async () => {
      writeCreds(racedFile, {
        ...expiredOauth,
        accessToken: "other-access",
        refreshToken: "other-refresh",
        expiresAt: now + 60 * 60 * 1000,
      });
      return {
        ok: true,
        status: 200,
        json: { access_token: "stale-winner", refresh_token: "stale-refresh", expires_in: 28800 },
      };
    },
  });
  assert.strictEqual(raced.token, "other-access", "a newer credential write must win over this refresh");
  assert.strictEqual(JSON.parse(fs.readFileSync(racedFile, "utf8")).claudeAiOauth.refreshToken, "other-refresh");

  const thrownFile = path.join(authDir, "thrown.json");
  writeCreds(thrownFile, expiredOauth);
  const thrown = await ensureClaudeAuth(null, {
    credentialsFile: thrownFile,
    now,
    requestJson: async () => {
      throw new Error("network down");
    },
  });
  assert.strictEqual(thrown, null);
  assert.strictEqual(JSON.parse(fs.readFileSync(thrownFile, "utf8")).claudeAiOauth.refreshToken, "old-refresh");

  const usageFile = path.join(authDir, "usage.json");
  writeCreds(usageFile, expiredOauth);
  const calls = [];
  const usage = await fetchUsage({}, {}, null, {
    credentialsFile: usageFile,
    now,
    requestJson: async (url, init) => {
      calls.push(url);
      if (url === OAUTH_TOKEN_URL) {
        return {
          ok: true,
          status: 200,
          json: { access_token: "usage-access", refresh_token: "usage-refresh", expires_in: 28800 },
        };
      }
      if (url.startsWith("https://api.anthropic.com/api/oauth/usage")) {
        assert.match(init.headers.Authorization, /^Bearer usage-access$/);
        return {
          ok: true,
          status: 200,
          json: {
            five_hour: { utilization: 42, resets_at: "2026-09-27T08:00:00.000Z" },
            cedar_ember: { ineligible_reason: "surface" },
          },
        };
      }
      return { ok: false, status: 404, json: null };
    },
  });
  assert.strictEqual(usage.status, "ok");
  assert.strictEqual(usage.remainingPct, 58);
  assert.strictEqual(usage.plan, "pro");
  assert.ok(calls.includes(OAUTH_TOKEN_URL));
  assert.strictEqual(JSON.parse(fs.readFileSync(usageFile, "utf8")).claudeAiOauth.refreshToken, "usage-refresh");

  const freshFile = path.join(authDir, "fresh.json");
  writeCreds(freshFile, { ...expiredOauth, accessToken: "fresh-access", expiresAt: now + 60 * 60 * 1000 });
  const freshCalls = [];
  const fresh = await fetchUsage({}, {}, null, {
    credentialsFile: freshFile,
    now,
    requestJson: async (url) => {
      freshCalls.push(url);
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return {
          ok: true,
          status: 200,
          json: {
            five_hour: { utilization: 10, resets_at: "2026-09-27T08:00:00.000Z" },
            cedar_ember: { ineligible_reason: "surface" },
          },
        };
      }
      return { ok: false, status: 404, json: null };
    },
  });
  assert.strictEqual(fresh.status, "ok");
  assert.strictEqual(fresh.remainingPct, 90);
  assert.ok(!freshCalls.includes(OAUTH_TOKEN_URL), "a fresh access token must not be refreshed");
  assert.strictEqual(JSON.parse(fs.readFileSync(freshFile, "utf8")).claudeAiOauth.refreshToken, "old-refresh");

  const retryFile = path.join(authDir, "retry.json");
  writeCreds(retryFile, { ...expiredOauth, accessToken: "rejected-access", expiresAt: now + 60 * 60 * 1000 });
  let usageTries = 0;
  const retried = await fetchUsage({}, {}, null, {
    credentialsFile: retryFile,
    now,
    requestJson: async (url) => {
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        usageTries += 1;
        if (usageTries === 1) return { ok: false, status: 401, json: null };
        return {
          ok: true,
          status: 200,
          json: {
            five_hour: { utilization: 5, resets_at: "2026-09-27T08:00:00.000Z" },
            cedar_ember: { ineligible_reason: "surface" },
          },
        };
      }
      if (url === OAUTH_TOKEN_URL) {
        return {
          ok: true,
          status: 200,
          json: { access_token: "retried-access", refresh_token: "retried-refresh", expires_in: 28800 },
        };
      }
      return { ok: false, status: 404, json: null };
    },
  });
  assert.strictEqual(usageTries, 2, "a 401 from a still-valid-looking token must refresh once and retry");
  assert.strictEqual(retried.status, "ok");
  assert.strictEqual(retried.remainingPct, 95);
  assert.strictEqual(JSON.parse(fs.readFileSync(retryFile, "utf8")).claudeAiOauth.accessToken, "retried-access");

  const deadFile = path.join(authDir, "dead.json");
  writeCreds(deadFile, {
    ...expiredOauth,
    refreshTokenExpiresAt: now - 1000,
  });
  const dead = await fetchUsage({}, {}, null, {
    credentialsFile: deadFile,
    now,
    requestJson: async () => {
      throw new Error("refresh must not be attempted");
    },
  });
  assert.strictEqual(dead.status, "login");
  assert.strictEqual(JSON.parse(fs.readFileSync(deadFile, "utf8")).claudeAiOauth.refreshToken, "old-refresh");

  const absent = await fetchUsage({}, {}, null, {
    credentialsFile: path.join(authDir, "missing.json"),
    now,
    requestJson: async () => {
      throw new Error("missing credentials must not call the network");
    },
  });
  assert.strictEqual(absent.status, "missing");

  const limitedFile = path.join(authDir, "limited.json");
  writeCreds(limitedFile, expiredOauth);
  let limitedCalls = 0;
  const limited = await ensureClaudeAuth(null, {
    credentialsFile: limitedFile,
    now,
    requestJson: async () => {
      limitedCalls += 1;
      return { ok: false, status: 429, json: null };
    },
  });
  assert.strictEqual(limited, null);
  const limitedAgain = await ensureClaudeAuth(null, {
    credentialsFile: limitedFile,
    now: now + 1000,
    requestJson: async () => {
      limitedCalls += 1;
      return { ok: false, status: 429, json: null };
    },
  });
  assert.strictEqual(limitedAgain, null);
  assert.strictEqual(limitedCalls, 1, "a 429 must back off before another refresh");
  assert.strictEqual(JSON.parse(fs.readFileSync(limitedFile, "utf8")).claudeAiOauth.refreshToken, "old-refresh");

  fs.rmSync(authDir, { recursive: true, force: true });
  console.log("Claude OAuth refresh tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
