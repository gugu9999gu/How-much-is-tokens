const assert = require("assert");
const http = require("http");
const {
  OPENROUTER_AUTH_URL,
  OPENROUTER_KEY_EXCHANGE_URL,
  CALLBACK_HOST,
  createPkceMaterial,
  buildAuthorizationUrl,
  createLoopbackCallback,
  exchangeAuthorizationCode,
} = require("../lib/openrouter-oauth");

function get(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
  });
}

(async () => {
  const random = (size) => Buffer.alloc(size, 7);
  const first = createPkceMaterial(random);
  const second = createPkceMaterial(random);
  assert.strictEqual(first.verifier, second.verifier);
  assert.strictEqual(first.challenge, second.challenge);
  assert.ok(first.verifier.length >= 40);
  assert.ok(first.challenge.length >= 40);

  const callbackUrl = "http://127.0.0.1:43199/callback/example";
  const authorization = new URL(buildAuthorizationUrl(callbackUrl, first.challenge));
  assert.strictEqual(`${authorization.origin}${authorization.pathname}`, OPENROUTER_AUTH_URL);
  assert.strictEqual(authorization.searchParams.get("callback_url"), callbackUrl);
  assert.strictEqual(authorization.searchParams.get("code_challenge"), first.challenge);
  assert.strictEqual(authorization.searchParams.get("code_challenge_method"), "S256");

  const callback = await createLoopbackCallback({ timeoutMs: 30_000 });
  try {
    const parsed = new URL(callback.callbackUrl);
    assert.strictEqual(parsed.hostname, CALLBACK_HOST, "OAuth callback must be IPv4 loopback only");
    assert.ok(Number(parsed.port) > 0);
    assert.ok(parsed.pathname.startsWith("/callback/"));

    const wrong = await get(`http://${CALLBACK_HOST}:${parsed.port}/callback/wrong?code=ignored`);
    assert.strictEqual(wrong.status, 404);

    const code = ["oauth", "authorization", "fixture"].join("-");
    const successPromise = get(`${callback.callbackUrl}?code=${encodeURIComponent(code)}`);
    assert.strictEqual(await callback.codePromise, code);
    const success = await successPromise;
    assert.strictEqual(success.status, 200);
    assert.ok(success.body.includes("OpenRouter 연결 완료"));
  } finally {
    callback.close();
  }

  const apiKey = ["openrouter", "oauth", "key", "fixture"].join("-");
  let exchangeCall = null;
  const exchanged = await exchangeAuthorizationCode("code-fixture", "verifier-fixture", async (url, init) => {
    exchangeCall = { url, init };
    return new Response(JSON.stringify({ key: apiKey }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.strictEqual(exchanged, apiKey);
  assert.strictEqual(exchangeCall.url, OPENROUTER_KEY_EXCHANGE_URL);
  assert.strictEqual(exchangeCall.init.method, "POST");
  const body = JSON.parse(exchangeCall.init.body);
  assert.strictEqual(body.code, "code-fixture");
  assert.strictEqual(body.code_verifier, "verifier-fixture");
  assert.strictEqual(body.code_challenge_method, "S256");

  await assert.rejects(
    () => exchangeAuthorizationCode("bad", "bad", async () => new Response(JSON.stringify({ error: "invalid" }), { status: 400 })),
    /invalid|failed/i,
  );

  console.log("OpenRouter localhost OAuth PKCE tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});