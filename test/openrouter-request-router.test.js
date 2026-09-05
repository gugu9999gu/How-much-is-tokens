const assert = require("assert");
const http = require("http");
const {
  LOOPBACK_HOST,
  constantTimeEqual,
  parseRetryAfter,
  upstreamUrl,
  OpenRouterRequestRouter,
} = require("../lib/openrouter-request-router");

// Keep all credential-like fixtures assembled at runtime so repository secret
// scanners never need a test-only allowlist.
const LOCAL_TOKEN = ["local", "router", "fixture", "token"].join("-");
const PRIMARY_KEY = ["api", "fixture", "primary"].join("-");
const BACKUP_KEY = ["api", "fixture", "backup"].join("-");
const STREAM_KEY = ["api", "fixture", "stream"].join("-");
const bearer = (value) => ["Bearer", value].join(" ");

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: LOOPBACK_HOST,
      port,
      path: options.path || "/v1/chat/completions",
      method: options.method || "POST",
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      let settled = false;
      const finish = (aborted = false) => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          aborted,
        });
      };
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => finish(false));
      res.on("aborted", () => finish(true));
      res.on("error", () => finish(true));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  assert.strictEqual(constantTimeEqual("same-token", "same-token"), true);
  assert.strictEqual(constantTimeEqual("same-token", "different-token"), false);
  assert.strictEqual(upstreamUrl("/v1/chat/completions?x=1"), "https://openrouter.ai/api/v1/chat/completions?x=1");
  assert.strictEqual(upstreamUrl("/not-v1"), null);
  assert.strictEqual(parseRetryAfter("2", 1000), 2000);

  let now = 1_000_000;
  const calls = [];
  const secrets = {
    primary: { apiKey: PRIMARY_KEY },
    backup: { apiKey: BACKUP_KEY },
  };
  const fetchImpl = async (_url, init) => {
    calls.push(init.headers.authorization);
    if (init.headers.authorization === bearer(PRIMARY_KEY)) {
      return new Response(JSON.stringify({ error: "limited" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const router = new OpenRouterRequestRouter({
    loadProfileSecrets: (id) => secrets[id] || {},
    ensureLocalToken: () => LOCAL_TOKEN,
    fetchImpl,
    now: () => now,
  });
  router.settings = {
    openRouterProfiles: [
      { id: "primary", label: "Primary", priority: 10, enabled: true },
      { id: "backup", label: "Backup", priority: 20, enabled: true },
    ],
    openRouterRouter: { enabled: true, port: 43123, policy: "priority-fallback" },
  };
  router.localToken = LOCAL_TOKEN;
  await router.start(0);
  const address = router.server.address();
  assert.strictEqual(address.address, LOOPBACK_HOST, "router must bind only to IPv4 loopback");
  const port = address.port;

  const unauthorized = await request(port, {
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.strictEqual(unauthorized.status, 401);
  assert.strictEqual(calls.length, 0, "local auth failure must never reach upstream");

  const failover = await request(port, {
    headers: {
      authorization: bearer(LOCAL_TOKEN),
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "example/model", messages: [] }),
  });
  assert.strictEqual(failover.status, 200);
  assert.strictEqual(failover.headers["x-how-much-is-tokens-profile"], "backup");
  assert.deepStrictEqual(calls, [bearer(PRIMARY_KEY), bearer(BACKUP_KEY)]);
  assert.ok(Number(router.cooldowns.get("primary")) > now, "429 key must enter cooldown");

  router.cooldowns.clear();
  router.settings.openRouterRouter.policy = "max-remaining";
  router.updateProfileMetrics([
    { providerId: "openrouter", profileId: "primary", remainingPct: 10, status: "ok" },
    { providerId: "openrouter", profileId: "backup", remainingPct: 90, status: "ok" },
  ]);
  calls.length = 0;
  const maxRemaining = await request(port, {
    headers: { authorization: bearer(LOCAL_TOKEN), "content-type": "application/json" },
    body: "{}",
  });
  assert.strictEqual(maxRemaining.status, 200);
  assert.deepStrictEqual(calls, [bearer(BACKUP_KEY)], "max-remaining must prefer fresher higher remaining profile");

  const alwaysLimited = new OpenRouterRequestRouter({
    loadProfileSecrets: (id) => secrets[id] || {},
    fetchImpl: async () => new Response("limited", { status: 429 }),
    now: () => now,
  });
  alwaysLimited.settings = router.settings;
  alwaysLimited.localToken = LOCAL_TOKEN;
  await alwaysLimited.start(0);
  const unavailable = await request(alwaysLimited.server.address().port, {
    headers: { authorization: bearer(LOCAL_TOKEN), "content-type": "application/json" },
    body: "{}",
  });
  assert.strictEqual(unavailable.status, 503, "all unavailable profiles must fail closed");
  assert.ok(unavailable.body.includes("all_openrouter_keys_unavailable"));
  await alwaysLimited.stop();

  let streamCalls = 0;
  const streaming = new OpenRouterRequestRouter({
    loadProfileSecrets: () => ({ apiKey: STREAM_KEY }),
    fetchImpl: async () => {
      streamCalls += 1;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          setTimeout(() => controller.error(new Error("synthetic-stream-failure")), 5);
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  streaming.settings = {
    openRouterProfiles: [
      { id: "one", label: "One", priority: 10, enabled: true },
      { id: "two", label: "Two", priority: 20, enabled: true },
    ],
    openRouterRouter: { enabled: true, port: 43123, policy: "priority-fallback" },
  };
  streaming.localToken = LOCAL_TOKEN;
  await streaming.start(0);
  const streamed = await request(streaming.server.address().port, {
    headers: { authorization: bearer(LOCAL_TOKEN), "content-type": "application/json" },
    body: "{}",
  });
  assert.strictEqual(streamed.status, 200);
  assert.strictEqual(streamed.aborted, true, "synthetic stream failure should abort the committed response");
  assert.strictEqual(streamCalls, 1, "stream failure after response commit must never replay on another key");
  await streaming.stop();

  now += 31_000;
  router.cleanupCooldowns();
  await router.stop();
  console.log("OpenRouter localhost request router tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
