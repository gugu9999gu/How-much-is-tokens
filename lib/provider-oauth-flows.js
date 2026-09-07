const crypto = require("crypto");
const http = require("http");

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

const CHATGPT = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  port: 1455,
  path: "/auth/callback",
  advertiseHost: "localhost",
  scopes: "openid profile email offline_access api.connectors.read api.connectors.invoke",
};

const ANTHROPIC = {
  clientId: Buffer.from("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl", "base64").toString("utf8"),
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://api.anthropic.com/v1/oauth/token",
  port: 54545,
  path: "/callback",
  advertiseHost: "localhost",
  scopes: "org:create_api_key user:profile user:inference",
};

const XAI = {
  discoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  port: 56121,
  path: "/callback",
  advertiseHost: "127.0.0.1",
  scopes: "openid profile email offline_access grok-cli:access api:access",
};

const CURSOR = {
  loginUrl: "https://cursor.com/loginDeepControl",
  pollUrl: "https://api2.cursor.sh/auth/poll",
  refreshUrl: "https://api2.cursor.sh/auth/exchange_user_api_key",
};

const COPILOT = {
  clientId: "Iv1.b507a08c87ecfe98",
  deviceCodeUrl: "https://github.com/login/device/code",
  accessTokenUrl: "https://github.com/login/oauth/access_token",
  copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
  userUrl: "https://api.github.com/user",
  verifyOrigin: "https://github.com",
  verifyPath: "/login/device",
};

const ANTIGRAVITY = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  // Public OAuth client credential embedded in the Antigravity desktop client.
  clientSecret: Buffer.from("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf8"),
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  prodApi: "https://cloudcode-pa.googleapis.com",
  dailyApi: "https://daily-cloudcode-pa.googleapis.com",
  port: 51121,
  path: "/callback",
  advertiseHost: "127.0.0.1",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
};

function timeoutSignal(parent, timeoutMs = REQUEST_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function identityFromJwt(...tokens) {
  for (const token of tokens) {
    if (!token) continue;
    const payload = decodeJwtPayload(token);
    if (!payload) continue;
    const namespaced = payload["https://api.openai.com/auth"];
    const accountId = firstString(
      payload.chatgpt_account_id,
      namespaced && namespaced.chatgpt_account_id,
      payload.sub,
    );
    const email = firstString(payload.email);
    if (accountId || email) return { accountId: accountId || undefined, email: email ? email.toLowerCase() : undefined };
  }
  return {};
}

function successHtml(provider) {
  const safe = String(provider || "OAuth").replace(/[&<>"']/g, "");
  return `<!doctype html><meta charset="utf-8"><title>${safe}</title><body style="font-family:system-ui;text-align:center;padding:4rem"><h2>로그인 완료</h2><p>이 탭을 닫고 토큰 위젯으로 돌아가세요.</p></body>`;
}

function errorHtml(message) {
  const safe = String(message || "로그인 실패").replace(/[&<>"']/g, "");
  return `<!doctype html><meta charset="utf-8"><title>로그인 실패</title><body style="font-family:system-ui;text-align:center;padding:4rem"><h2>로그인 실패</h2><p>${safe}</p></body>`;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function createCallbackListener(options = {}) {
  const state = String(options.state || "");
  const callbackPath = String(options.path || "/callback");
  const advertiseHost = String(options.advertiseHost || "127.0.0.1");
  const port = Number(options.port);
  const provider = String(options.provider || "OAuth");
  if (!state || !Number.isInteger(port) || port <= 0) throw new Error("잘못된 OAuth callback 설정입니다.");

  let settled = false;
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const handler = (req, res) => {
    let url;
    try { url = new URL(req.url, `http://${advertiseHost}:${port}`); } catch { url = null; }
    if (!url || url.pathname !== callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const returnedState = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error") || "";
    if (returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(errorHtml("state 검증에 실패했습니다."));
      return;
    }
    if (settled) {
      res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Login already completed");
      return;
    }
    settled = true;
    if (oauthError || !code) {
      const message = oauthError ? `OAuth authorization failed: ${oauthError}` : "authorization code가 없습니다.";
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(errorHtml(message));
      rejectResult(new Error(message));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(successHtml(provider));
    resolveResult({ code, state: returnedState });
  };

  const servers = [];
  const primary = http.createServer(handler);
  await listen(primary, "127.0.0.1", port);
  servers.push(primary);

  if (advertiseHost.toLowerCase() === "localhost") {
    const ipv6 = http.createServer(handler);
    try {
      await listen(ipv6, "::1", port);
      servers.push(ipv6);
    } catch (error) {
      ipv6.close();
      if (error && error.code === "EADDRINUSE") {
        servers.forEach((server) => server.close());
        throw new Error(`OAuth callback port ${port}의 IPv6 loopback이 다른 프로세스에서 사용 중입니다.`);
      }
    }
  }

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectResult(new Error("OAuth 로그인 시간이 초과되었습니다."));
  }, options.timeoutMs || OAUTH_TIMEOUT_MS);
  timer.unref?.();

  return {
    redirectUri: `http://${advertiseHost}:${port}${callbackPath}`,
    resultPromise,
    close() {
      clearTimeout(timer);
      servers.forEach((server) => {
        try { server.close(); } catch {}
      });
    },
  };
}

async function readJsonResponse(response, action) {
  if (!response.ok) throw new Error(`${action} 실패 (HTTP ${response.status})`);
  try { return await response.json(); } catch { throw new Error(`${action} 응답이 올바른 JSON이 아닙니다.`); }
}

async function runBrowserCodeFlow(options) {
  const state = crypto.randomBytes(20).toString("base64url");
  const listener = await createCallbackListener({
    state,
    provider: options.provider,
    port: options.port,
    path: options.path,
    advertiseHost: options.advertiseHost,
  });
  try {
    const auth = await options.buildAuth({ state, redirectUri: listener.redirectUri });
    await options.openExternal(auth.url);
    const { code } = await listener.resultPromise;
    return await options.exchange({ code, state, redirectUri: listener.redirectUri, context: auth.context || {} });
  } finally {
    listener.close();
  }
}

async function loginChatGPT({ openExternal }) {
  const pkce = generatePkce();
  return runBrowserCodeFlow({
    provider: "ChatGPT/Codex",
    port: CHATGPT.port,
    path: CHATGPT.path,
    advertiseHost: CHATGPT.advertiseHost,
    openExternal,
    buildAuth({ state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CHATGPT.clientId,
        redirect_uri: redirectUri,
        scope: CHATGPT.scopes,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        state,
        codex_cli_simplified_flow: "true",
        id_token_add_organizations: "true",
        prompt: "login",
      });
      return { url: `${CHATGPT.authorizeUrl}?${params.toString()}` };
    },
    async exchange({ code, redirectUri }) {
      const response = await fetch(CHATGPT.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CHATGPT.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier,
        }),
        signal: timeoutSignal(),
      });
      const data = await readJsonResponse(response, "ChatGPT token exchange");
      if (!data.access_token) throw new Error("ChatGPT token 응답에 access token이 없습니다.");
      const identity = identityFromJwt(data.id_token, data.access_token);
      return {
        access: data.access_token,
        refresh: data.refresh_token || "",
        expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 60_000,
        ...identity,
        source: "oauth",
      };
    },
  });
}

async function refreshChatGPT(credential, signal) {
  if (!credential.refresh) throw new Error("ChatGPT refresh token이 없습니다.");
  const response = await fetch(CHATGPT.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: CHATGPT.clientId, refresh_token: credential.refresh }),
    signal: timeoutSignal(signal),
  });
  const data = await readJsonResponse(response, "ChatGPT token refresh");
  if (!data.access_token) throw new Error("ChatGPT refresh 응답에 access token이 없습니다.");
  return {
    ...credential,
    access: data.access_token,
    refresh: data.refresh_token || credential.refresh,
    expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 60_000,
    ...identityFromJwt(data.id_token, data.access_token),
  };
}

async function loginAnthropic({ openExternal }) {
  const pkce = generatePkce();
  return runBrowserCodeFlow({
    provider: "Claude",
    port: ANTHROPIC.port,
    path: ANTHROPIC.path,
    advertiseHost: ANTHROPIC.advertiseHost,
    openExternal,
    buildAuth({ state, redirectUri }) {
      const params = new URLSearchParams({
        code: "true",
        client_id: ANTHROPIC.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: ANTHROPIC.scopes,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        state,
      });
      return { url: `${ANTHROPIC.authorizeUrl}?${params.toString()}` };
    },
    async exchange({ code, state, redirectUri }) {
      const response = await fetch(ANTHROPIC.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: ANTHROPIC.clientId,
          code,
          state,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier,
        }),
        signal: timeoutSignal(),
      });
      const data = await readJsonResponse(response, "Claude OAuth token exchange");
      if (!data.access_token) throw new Error("Claude OAuth 응답에 access token이 없습니다.");
      return {
        access: data.access_token,
        refresh: data.refresh_token || "",
        expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 5 * 60_000,
        accountId: firstString(data.account && data.account.uuid) || undefined,
        email: firstString(data.account && data.account.email_address)?.toLowerCase(),
        source: "oauth",
      };
    },
  });
}

async function refreshAnthropic(credential, signal) {
  if (!credential.refresh) throw new Error("Claude refresh token이 없습니다.");
  const response = await fetch(ANTHROPIC.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: ANTHROPIC.clientId, refresh_token: credential.refresh }),
    signal: timeoutSignal(signal),
  });
  const data = await readJsonResponse(response, "Claude OAuth token refresh");
  return {
    ...credential,
    access: data.access_token || credential.access,
    refresh: data.refresh_token || credential.refresh,
    expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 5 * 60_000,
    accountId: firstString(data.account && data.account.uuid, credential.accountId) || undefined,
    email: (firstString(data.account && data.account.email_address, credential.email) || "").toLowerCase() || undefined,
  };
}

function validateXaiEndpoint(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "x.ai" && !host.endsWith(".x.ai"))) {
    throw new Error("xAI OAuth discovery가 허용되지 않은 endpoint를 반환했습니다.");
  }
  return url.toString();
}

async function discoverXai(signal) {
  const response = await fetch(XAI.discoveryUrl, { headers: { Accept: "application/json" }, signal: timeoutSignal(signal) });
  const data = await readJsonResponse(response, "xAI OAuth discovery");
  if (!data.authorization_endpoint || !data.token_endpoint) throw new Error("xAI OAuth discovery endpoint가 불완전합니다.");
  return { authorizeUrl: validateXaiEndpoint(data.authorization_endpoint), tokenUrl: validateXaiEndpoint(data.token_endpoint) };
}

function xaiCredential(data, fallback = {}) {
  if (!data.access_token) throw new Error("xAI OAuth 응답에 access token이 없습니다.");
  const refresh = data.refresh_token || fallback.refresh || "";
  if (!refresh) throw new Error("xAI OAuth 응답에 refresh token이 없습니다.");
  return {
    ...fallback,
    access: data.access_token,
    refresh,
    expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 2 * 60_000,
    ...identityFromJwt(data.id_token, data.access_token),
    source: "oauth",
  };
}

async function loginXai({ openExternal }) {
  const pkce = generatePkce();
  const discovery = await discoverXai();
  return runBrowserCodeFlow({
    provider: "Grok/xAI",
    port: XAI.port,
    path: XAI.path,
    advertiseHost: XAI.advertiseHost,
    openExternal,
    buildAuth({ state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: XAI.clientId,
        redirect_uri: redirectUri,
        scope: XAI.scopes,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        state,
        nonce: crypto.randomUUID(),
        prompt: "login",
      });
      return { url: `${discovery.authorizeUrl}?${params.toString()}` };
    },
    async exchange({ code, redirectUri }) {
      const response = await fetch(discovery.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: XAI.clientId, code, redirect_uri: redirectUri, code_verifier: pkce.verifier }),
        signal: timeoutSignal(),
      });
      return xaiCredential(await readJsonResponse(response, "xAI OAuth token exchange"));
    },
  });
}

async function refreshXai(credential, signal) {
  if (!credential.refresh) throw new Error("xAI refresh token이 없습니다.");
  const discovery = await discoverXai(signal);
  const response = await fetch(discovery.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: XAI.clientId, refresh_token: credential.refresh }),
    signal: timeoutSignal(signal),
  });
  return xaiCredential(await readJsonResponse(response, "xAI OAuth token refresh"), credential);
}

function cursorCredential(access, refresh, fallback = {}) {
  if (!access) throw new Error("Cursor OAuth 응답에 access token이 없습니다.");
  const payload = decodeJwtPayload(access) || decodeJwtPayload(refresh) || {};
  const exp = Number(payload.exp);
  return {
    ...fallback,
    access,
    refresh: refresh || fallback.refresh || "",
    expires: Number.isFinite(exp) ? exp * 1000 - 5 * 60_000 : Date.now() + 55 * 60_000,
    accountId: firstString(payload.sub, fallback.accountId) || undefined,
    email: (firstString(payload.email, fallback.email) || "").toLowerCase() || undefined,
    source: "oauth",
  };
}

async function loginCursor({ openExternal, forceLogin = false, signal }) {
  const pkce = generatePkce();
  const uuid = crypto.randomUUID();
  const params = new URLSearchParams({ challenge: pkce.challenge, uuid, mode: "login", redirectTarget: "cli" });
  await openExternal(`${CURSOR.loginUrl}?${params.toString()}`);
  const deadline = Date.now() + OAUTH_TIMEOUT_MS;
  let delay = 1000;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cursor 로그인 취소됨")); }, { once: true });
    });
    try {
      const response = await fetch(`${CURSOR.pollUrl}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(pkce.verifier)}`, { signal: timeoutSignal(signal, 15_000) });
      if (response.status === 404) {
        consecutiveErrors = 0;
        delay = Math.min(Math.ceil(delay * 1.2), 10_000);
        continue;
      }
      if ([400, 401, 403, 410].includes(response.status)) throw new Error(`Cursor 로그인 요청이 거부되었거나 만료되었습니다 (HTTP ${response.status}).`);
      const data = await readJsonResponse(response, "Cursor OAuth poll");
      if (!data.accessToken || !data.refreshToken) throw new Error("Cursor OAuth 응답에 token이 없습니다.");
      return cursorCredential(data.accessToken, data.refreshToken);
    } catch (error) {
      if (String(error.message || "").includes("거부") || String(error.message || "").includes("만료")) throw error;
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) throw new Error("Cursor 로그인 상태 확인 중 연속 네트워크 오류가 발생했습니다.");
      delay = Math.min(Math.ceil(delay * 1.2), 10_000);
    }
  }
  throw new Error(forceLogin ? "Cursor 다른 계정 로그인 시간이 초과되었습니다." : "Cursor 로그인 시간이 초과되었습니다.");
}

async function refreshCursor(credential, signal) {
  if (!credential.refresh) throw new Error("Cursor refresh token이 없습니다.");
  const response = await fetch(CURSOR.refreshUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.refresh}`, "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
    signal: timeoutSignal(signal, 15_000),
  });
  const data = await readJsonResponse(response, "Cursor token refresh");
  return cursorCredential(data.accessToken, data.refreshToken || credential.refresh, credential);
}

function allowedGithubVerifyUrl(userCode) {
  if (!/^[A-Z0-9-]+$/i.test(String(userCode || ""))) throw new Error("GitHub device code가 올바르지 않습니다.");
  return `${COPILOT.verifyOrigin}${COPILOT.verifyPath}?user_code=${encodeURIComponent(userCode)}`;
}

async function githubIdentity(githubAccess, signal) {
  const response = await fetch(COPILOT.userUrl, {
    headers: { Authorization: `Bearer ${githubAccess}`, Accept: "application/vnd.github+json", "User-Agent": "how-much-is-tokens", "X-GitHub-Api-Version": "2022-11-28" },
    signal: timeoutSignal(signal, 15_000),
  });
  const data = await readJsonResponse(response, "GitHub identity lookup");
  const accountId = data.id != null ? String(data.id) : firstString(data.login);
  if (!accountId) throw new Error("GitHub 계정 identity를 확인하지 못했습니다.");
  return { accountId, email: typeof data.email === "string" && data.email.includes("@") ? data.email.toLowerCase() : undefined };
}

async function exchangeCopilot(githubAccess, signal) {
  const response = await fetch(COPILOT.copilotTokenUrl, {
    headers: {
      Authorization: `token ${githubAccess}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat",
      "User-Agent": "how-much-is-tokens",
    },
    signal: timeoutSignal(signal, 15_000),
  });
  const data = await readJsonResponse(response, "GitHub Copilot token exchange");
  if (!data.token) throw new Error("GitHub 계정에 사용 가능한 Copilot token이 없습니다.");
  const expires = Number.isFinite(Number(data.expires_at))
    ? Number(data.expires_at) * 1000 - 2 * 60_000
    : Date.now() + Math.max(60, Number(data.refresh_in) || 1500) * 1000 - 2 * 60_000;
  return { access: data.token, expires };
}

async function loginCopilot({ openExternal, signal }) {
  const deviceResponse = await fetch(COPILOT.deviceCodeUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "how-much-is-tokens" },
    body: new URLSearchParams({ client_id: COPILOT.clientId, scope: "read:user" }),
    signal: timeoutSignal(signal),
  });
  const device = await readJsonResponse(deviceResponse, "GitHub device authorization");
  if (!device.user_code || !device.device_code) throw new Error("GitHub device authorization 응답이 불완전합니다.");
  const verifyUrl = allowedGithubVerifyUrl(device.user_code);
  await openExternal(verifyUrl);
  const deadline = Date.now() + Math.max(60, Number(device.expires_in) || 900) * 1000;
  let waitMs = Math.max(1000, (Number(device.interval) || 5) * 1000);
  let github = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const response = await fetch(COPILOT.accessTokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "how-much-is-tokens" },
      body: new URLSearchParams({ client_id: COPILOT.clientId, device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      signal: timeoutSignal(signal, 15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.access_token) {
      github = { access: data.access_token, refresh: data.refresh_token || data.access_token };
      break;
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") { waitMs += 5000; continue; }
    if (data.error === "access_denied") throw new Error("GitHub device authorization이 거부되었습니다.");
    if (data.error === "expired_token") throw new Error("GitHub device authorization이 만료되었습니다.");
    if (!response.ok) throw new Error(`GitHub device token 요청 실패 (HTTP ${response.status})`);
  }
  if (!github) throw new Error("GitHub Copilot 로그인 시간이 초과되었습니다.");
  const [copilot, identity] = await Promise.all([exchangeCopilot(github.access, signal), githubIdentity(github.access, signal)]);
  return {
    access: copilot.access,
    refresh: github.refresh,
    githubAccess: github.access,
    expires: copilot.expires,
    ...identity,
    source: "oauth",
  };
}

async function refreshCopilot(credential, signal) {
  if (!credential.refresh) throw new Error("GitHub durable OAuth grant가 없습니다.");
  let githubAccess = credential.githubAccess || credential.refresh;
  let durable = credential.refresh;
  if (credential.refresh.startsWith("ghr_")) {
    const response = await fetch(COPILOT.accessTokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "how-much-is-tokens" },
      body: new URLSearchParams({ client_id: COPILOT.clientId, grant_type: "refresh_token", refresh_token: credential.refresh }),
      signal: timeoutSignal(signal, 15_000),
    });
    const data = await readJsonResponse(response, "GitHub OAuth refresh");
    if (!data.access_token) throw new Error("GitHub OAuth refresh 응답에 access token이 없습니다.");
    githubAccess = data.access_token;
    durable = data.refresh_token || credential.refresh;
  }
  const [copilot, identity] = await Promise.all([exchangeCopilot(githubAccess, signal), githubIdentity(githubAccess, signal)]);
  return { ...credential, access: copilot.access, refresh: durable, githubAccess, expires: copilot.expires, ...identity };
}

function extractProjectId(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
    const value = data[key];
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object" && typeof value.id === "string" && value.id) return value.id;
  }
  return null;
}

async function discoverAntigravityProject(access, signal) {
  const response = await fetch(`${ANTIGRAVITY.prodApi}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, Accept: "*/*", "Content-Type": "application/json", "User-Agent": "antigravity/ide/2.5.5" },
    body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
    signal: timeoutSignal(signal),
  });
  if (response.ok) {
    const project = extractProjectId(await response.json().catch(() => ({})));
    if (project) return project;
  }
  return null;
}

async function googleIdentity(access, signal) {
  const response = await fetch(ANTIGRAVITY.userInfoUrl, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }, signal: timeoutSignal(signal) });
  const data = await readJsonResponse(response, "Google identity lookup");
  return {
    accountId: data.id != null ? String(data.id) : undefined,
    email: typeof data.email === "string" ? data.email.toLowerCase() : undefined,
  };
}

function antigravityCredential(data, fallback = {}) {
  if (!data.access_token) throw new Error("Antigravity OAuth 응답에 access token이 없습니다.");
  const refresh = data.refresh_token || fallback.refresh || "";
  if (!refresh) throw new Error("Antigravity OAuth 응답에 refresh token이 없습니다.");
  return {
    ...fallback,
    access: data.access_token,
    refresh,
    expires: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000 - 5 * 60_000,
    source: "oauth",
  };
}

async function loginAntigravity({ openExternal, signal, addAccount = false }) {
  const pkce = generatePkce();
  const base = await runBrowserCodeFlow({
    provider: "Antigravity",
    port: ANTIGRAVITY.port,
    path: ANTIGRAVITY.path,
    advertiseHost: ANTIGRAVITY.advertiseHost,
    openExternal,
    buildAuth({ state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: ANTIGRAVITY.clientId,
        redirect_uri: redirectUri,
        scope: ANTIGRAVITY.scopes.join(" "),
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: addAccount ? "consent select_account" : "consent",
        state,
      });
      return { url: `${ANTIGRAVITY.authorizeUrl}?${params.toString()}` };
    },
    async exchange({ code, redirectUri }) {
      const response = await fetch(ANTIGRAVITY.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ANTIGRAVITY.clientId,
          client_secret: ANTIGRAVITY.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier,
        }),
        signal: timeoutSignal(signal),
      });
      return antigravityCredential(await readJsonResponse(response, "Antigravity OAuth token exchange"));
    },
  });
  const [identity, projectId] = await Promise.all([
    googleIdentity(base.access, signal),
    discoverAntigravityProject(base.access, signal),
  ]);
  if (!projectId) throw new Error("Antigravity Cloud Code Assist project를 확인하지 못했습니다. agy 로그인을 fallback으로 사용할 수 있습니다.");
  return { ...base, ...identity, projectId };
}

async function refreshAntigravity(credential, signal) {
  if (!credential.refresh) throw new Error("Antigravity refresh token이 없습니다.");
  const response = await fetch(ANTIGRAVITY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: ANTIGRAVITY.clientId, client_secret: ANTIGRAVITY.clientSecret, refresh_token: credential.refresh }),
    signal: timeoutSignal(signal),
  });
  const fresh = antigravityCredential(await readJsonResponse(response, "Antigravity OAuth refresh"), credential);
  const [identity, projectId] = await Promise.all([
    googleIdentity(fresh.access, signal).catch(() => ({ accountId: credential.accountId, email: credential.email })),
    discoverAntigravityProject(fresh.access, signal).catch(() => credential.projectId),
  ]);
  return { ...fresh, ...identity, projectId: projectId || credential.projectId };
}

const LOGIN_HANDLERS = Object.freeze({
  codex: loginChatGPT,
  claude: loginAnthropic,
  grok: loginXai,
  cursor: loginCursor,
  copilot: loginCopilot,
  antigravity: loginAntigravity,
});

const REFRESH_HANDLERS = Object.freeze({
  codex: refreshChatGPT,
  claude: refreshAnthropic,
  grok: refreshXai,
  cursor: refreshCursor,
  copilot: refreshCopilot,
  antigravity: refreshAntigravity,
});

async function loginProvider(providerId, options = {}) {
  const handler = LOGIN_HANDLERS[String(providerId || "").toLowerCase()];
  if (!handler) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  return handler(options);
}

async function refreshProviderCredential(providerId, credential, signal) {
  const handler = REFRESH_HANDLERS[String(providerId || "").toLowerCase()];
  if (!handler) throw new Error("지원되지 않는 OAuth 공급자입니다.");
  return handler(credential, signal);
}

module.exports = {
  CHATGPT,
  ANTHROPIC,
  XAI,
  CURSOR,
  COPILOT,
  ANTIGRAVITY,
  generatePkce,
  decodeJwtPayload,
  identityFromJwt,
  createCallbackListener,
  runBrowserCodeFlow,
  loginChatGPT,
  refreshChatGPT,
  loginAnthropic,
  refreshAnthropic,
  discoverXai,
  loginXai,
  refreshXai,
  cursorCredential,
  loginCursor,
  refreshCursor,
  loginCopilot,
  refreshCopilot,
  discoverAntigravityProject,
  loginAntigravity,
  refreshAntigravity,
  loginProvider,
  refreshProviderCredential,
};