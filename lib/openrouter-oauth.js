const crypto = require("crypto");
const http = require("http");

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const CALLBACK_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

function createPkceMaterial(randomBytesImpl = crypto.randomBytes) {
  const verifier = randomBytesImpl(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "utf8").digest("base64url");
  return { verifier, challenge };
}

function buildAuthorizationUrl(callbackUrl, challenge) {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function browserResponse(res, ok, message) {
  const title = ok ? "OpenRouter 연결 완료" : "OpenRouter 연결 실패";
  const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:520px;padding:32px}h1{font-size:22px}p{line-height:1.6;color:#aaa}</style><main><h1>${title}</h1><p>${message}</p><p>이 창을 닫고 How much is tokens로 돌아가세요.</p></main>`);
  res.statusCode = ok ? 200 : 400;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-length", String(body.length));
  res.end(body);
}

function createLoopbackCallback(options = {}) {
  const randomBytesImpl = options.randomBytesImpl || crypto.randomBytes;
  const timeoutMs = Math.max(30_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const nonce = randomBytesImpl(18).toString("base64url");
  const expectedPath = `/callback/${nonce}`;
  let settled = false;
  let timeout = null;
  let resolveCode;
  let rejectCode;

  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || "/", `http://${CALLBACK_HOST}`);
    if (parsed.pathname !== expectedPath) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    if (settled) {
      browserResponse(res, false, "이미 처리된 로그인 요청입니다.");
      return;
    }

    const code = parsed.searchParams.get("code");
    const error = parsed.searchParams.get("error");
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (code) {
      browserResponse(res, true, "인증이 완료되었습니다. API Key는 앱의 OS 보안 저장소에 저장됩니다.");
      resolveCode(code);
    } else {
      browserResponse(res, false, error || "인증 코드가 전달되지 않았습니다.");
      rejectCode(new Error(error || "OpenRouter OAuth code missing"));
    }
  });

  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CALLBACK_HOST, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      if (!port) {
        reject(new Error("OpenRouter OAuth callback port unavailable"));
        return;
      }
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectCode(new Error("OpenRouter OAuth login timed out"));
        try { server.close(); } catch {}
      }, timeoutMs);
      resolve({
        callbackUrl: `http://${CALLBACK_HOST}:${port}${expectedPath}`,
        codePromise,
        close: () => {
          if (timeout) clearTimeout(timeout);
          try { server.close(); } catch {}
        },
      });
    });
  });

  return ready;
}

async function exchangeAuthorizationCode(code, verifier, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable for OpenRouter OAuth");
  const response = await fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: String(code || ""),
      code_verifier: String(verifier || ""),
      code_challenge_method: "S256",
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload || typeof payload.key !== "string" || !payload.key.trim()) {
    const error = payload && (payload.error || payload.message);
    throw new Error(error || `OpenRouter OAuth exchange failed (HTTP ${response.status})`);
  }
  return payload.key.trim();
}

module.exports = {
  OPENROUTER_AUTH_URL,
  OPENROUTER_KEY_EXCHANGE_URL,
  CALLBACK_HOST,
  DEFAULT_TIMEOUT_MS,
  createPkceMaterial,
  buildAuthorizationUrl,
  createLoopbackCallback,
  exchangeAuthorizationCode,
};