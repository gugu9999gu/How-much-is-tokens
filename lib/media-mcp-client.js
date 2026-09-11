const crypto = require("crypto");
const http = require("http");
const { shell } = require("electron");
const { officialMcpFor, cleanMediaProviderId, cleanMediaProfileId } = require("./media-provider-profiles");
const {
  loadMediaProviderProfileSecrets,
  saveMediaProviderProfileSecrets,
} = require("./secure-secrets");

const CALLBACK_TIMEOUT_MS = 180_000;
const MCP_CONNECT_TIMEOUT_MS = 15_000;

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import("@modelcontextprotocol/client");
  return sdkPromise;
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function saveJsonSecret(providerId, profileId, field, value) {
  if (value == null) return;
  saveMediaProviderProfileSecrets(providerId, profileId, { [field]: JSON.stringify(value) });
}

function readJsonSecret(providerId, profileId, field, fallback = null) {
  const stored = loadMediaProviderProfileSecrets(providerId, profileId, [field]);
  return stored[field] ? parseJson(stored[field], fallback) : fallback;
}

function createLoopbackCallback() {
  let resolveCallback;
  let rejectCallback;
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url || "/", base);
    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset=utf-8><title>Connected</title><body style='font-family:system-ui;background:#111;color:#eee;padding:32px'>MCP 계정 연결이 완료되었습니다. 이 창을 닫아도 됩니다.</body>");
    resolveCallback(url);
  });
  const timer = setTimeout(() => rejectCallback(new Error("MCP OAuth callback timed out")), CALLBACK_TIMEOUT_MS);
  timer.unref?.();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        redirectUrl: `http://127.0.0.1:${address.port}/callback`,
        callbackPromise,
        close() {
          clearTimeout(timer);
          try { server.close(); } catch {}
        },
      });
    });
  });
}

class SecureOAuthProvider {
  constructor(providerId, profileId, redirectUrl, onRedirect) {
    this.providerId = providerId;
    this.profileId = profileId;
    this.redirectUrl = redirectUrl;
    this.onRedirect = onRedirect;
    this.lastState = null;
    this.clientMetadata = {
      client_name: "How much is tokens",
      redirect_uris: [redirectUrl],
      application_type: "native",
    };
  }

  clientInformation(ctx) {
    const map = readJsonSecret(this.providerId, this.profileId, "oauthClientInformation", {});
    return ctx && ctx.issuer ? map[ctx.issuer] : undefined;
  }

  saveClientInformation(info, ctx) {
    if (!ctx || !ctx.issuer) return;
    const map = readJsonSecret(this.providerId, this.profileId, "oauthClientInformation", {});
    map[ctx.issuer] = info;
    saveJsonSecret(this.providerId, this.profileId, "oauthClientInformation", map);
  }

  tokens() {
    return readJsonSecret(this.providerId, this.profileId, "oauthTokens", undefined);
  }

  saveTokens(tokens) {
    saveJsonSecret(this.providerId, this.profileId, "oauthTokens", tokens);
  }

  state() {
    this.lastState = crypto.randomUUID();
    return this.lastState;
  }

  saveDiscoveryState(state) {
    saveJsonSecret(this.providerId, this.profileId, "oauthDiscovery", state);
  }

  discoveryState() {
    return readJsonSecret(this.providerId, this.profileId, "oauthDiscovery", undefined);
  }

  redirectToAuthorization(url) {
    if (typeof this.onRedirect === "function") this.onRedirect(url);
  }

  saveCodeVerifier(verifier) {
    saveMediaProviderProfileSecrets(this.providerId, this.profileId, { oauthCodeVerifier: verifier });
  }

  codeVerifier() {
    const stored = loadMediaProviderProfileSecrets(this.providerId, this.profileId, ["oauthCodeVerifier"]);
    if (!stored.oauthCodeVerifier) throw new Error("MCP OAuth code verifier is missing");
    return stored.oauthCodeVerifier;
  }
}

function normalizeToolName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toolHasNoRequiredArgs(tool) {
  const required = tool && tool.inputSchema && Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required
    : [];
  return required.length === 0;
}

function selectBalanceTool(tools, candidates) {
  const list = Array.isArray(tools) ? tools.filter(toolHasNoRequiredArgs) : [];
  const desired = (Array.isArray(candidates) ? candidates : []).map(normalizeToolName);
  for (const candidate of desired) {
    const exact = list.find((tool) => normalizeToolName(tool.name) === candidate);
    if (exact) return exact;
  }
  for (const candidate of desired) {
    const partial = list.find((tool) => {
      const name = normalizeToolName(tool.name);
      return name.endsWith(`_${candidate}`) || name.includes(candidate);
    });
    if (partial) return partial;
  }
  return list.find((tool) => /balance|credit|subscription|usage/i.test(String(tool.name || ""))) || null;
}

function flatten(value, prefix = "", out = {}) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix.toLowerCase()] = value;
  return out;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findNumeric(flat, patterns) {
  for (const pattern of patterns) {
    const key = Object.keys(flat).find((name) => pattern.test(name));
    if (!key) continue;
    const n = finiteNumber(flat[key]);
    if (n != null) return n;
  }
  return null;
}

function textFromResult(result) {
  const parts = Array.isArray(result && result.content) ? result.content : [];
  return parts.filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim();
}

function structuredFromResult(result) {
  if (result && result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = textFromResult(result);
  if (!text) return null;
  const json = parseJson(text, null);
  return json && typeof json === "object" ? json : { text };
}

function parseTextBalance(text) {
  const input = String(text || "");
  const credits = input.match(/(?:balance|remaining|credits?)[^0-9-]{0,24}(-?\d+(?:\.\d+)?)/i)
    || input.match(/(-?\d+(?:\.\d+)?)\s*(?:credits?)/i);
  return credits ? finiteNumber(credits[1]) : null;
}

function extractMcpUsage(result, providerId) {
  const structured = structuredFromResult(result);
  if (!structured) return null;
  const flat = flatten(structured);
  const text = textFromResult(result) || (typeof structured.text === "string" ? structured.text : "");
  let balance = findNumeric(flat, [
    /remaining[_ .-]?credits?$/, /credit[_ .-]?balance$/, /current[_ .-]?balance$/, /balance$/, /credits?$/,
  ]);
  const limit = findNumeric(flat, [
    /character[_ .-]?limit$/, /credit[_ .-]?limit$/, /total[_ .-]?credits?$/, /quota[_ .-]?limit$/, /limit$/,
  ]);
  const used = findNumeric(flat, [
    /character[_ .-]?count$/, /credits?[_ .-]?used$/, /total[_ .-]?usage$/, /usage$/,
  ]);
  if (balance == null && limit != null && used != null) balance = Math.max(0, limit - used);
  if (balance == null) balance = parseTextBalance(text);

  const currencyKey = Object.keys(flat).find((key) => /currency$/.test(key));
  const unitKey = Object.keys(flat).find((key) => /unit$/.test(key));
  const planKey = Object.keys(flat).find((key) => /plan(?:[_ .-]?name)?$|tier$|subscription$/.test(key));
  const currency = currencyKey && typeof flat[currencyKey] === "string" ? flat[currencyKey].toUpperCase() : null;
  const unit = unitKey && typeof flat[unitKey] === "string" ? flat[unitKey] : null;
  const plan = planKey && typeof flat[planKey] !== "object" ? String(flat[planKey]) : null;
  const remainingPct = balance != null && limit != null && limit > 0
    ? Math.max(0, Math.min(100, balance / limit * 100))
    : null;

  const creditBalances = [];
  if (balance != null || limit != null || used != null) {
    creditBalances.push({
      id: "mcp-credits",
      label: providerId === "elevenlabs" && unit == null ? "MCP 사용량" : "MCP 크레딧",
      balance,
      used: used == null && balance != null && limit != null ? Math.max(0, limit - balance) : used,
      limit,
      currency: currency || undefined,
      unit: unit || undefined,
      remainingPct,
      source: `mcp:${providerId}`,
    });
  }
  return {
    balance,
    limit,
    used,
    remainingPct,
    plan,
    creditBalances,
    rawText: text.slice(0, 240),
  };
}

async function closeClient(client) {
  try { if (client && typeof client.close === "function") await client.close(); } catch {}
}

async function createConnectedClient(providerId, profile, options = {}) {
  const id = cleanMediaProviderId(providerId);
  const profileId = cleanMediaProfileId(profile && profile.id);
  const mcp = officialMcpFor(id);
  if (!id || !profileId || !mcp) return { ok: false, reason: "mcp-not-supported" };
  const sdk = options.sdk || await loadSdk();
  const { Client, StreamableHTTPClientTransport, UnauthorizedError } = sdk;
  if (!Client || !StreamableHTTPClientTransport) return { ok: false, reason: "mcp-sdk-unavailable" };
  const client = new Client({ name: "how-much-is-tokens", version: "1.0.32" }, { versionNegotiation: { mode: "auto" } });

  if (mcp.auth === "bearer-api-key") {
    const stored = loadMediaProviderProfileSecrets(id, profileId, [mcp.bearerField || "apiKey"]);
    const token = stored[mcp.bearerField || "apiKey"];
    if (!token) return { ok: false, reason: "mcp-credential-missing" };
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      authProvider: { token: async () => token },
    });
    try {
      await client.connect(transport);
      return { ok: true, client, transport, mcp };
    } catch (error) {
      await closeClient(client);
      return { ok: false, reason: "mcp-connect-failed", error: error && error.message ? error.message : String(error) };
    }
  }

  const interactive = options.interactive === true;
  let callback = null;
  let redirected = null;
  if (interactive) callback = await createLoopbackCallback();
  const redirectUrl = callback ? callback.redirectUrl : "http://127.0.0.1:19732/callback";
  const provider = new SecureOAuthProvider(id, profileId, redirectUrl, (url) => {
    redirected = url;
    if (interactive) shell.openExternal(url.toString()).catch(() => {});
  });
  let transport = new StreamableHTTPClientTransport(new URL(mcp.url), { authProvider: provider });
  try {
    await client.connect(transport);
    callback?.close();
    return { ok: true, client, transport, mcp, oauth: true };
  } catch (error) {
    const unauthorized = UnauthorizedError && error instanceof UnauthorizedError;
    if (!unauthorized) {
      callback?.close();
      await closeClient(client);
      return { ok: false, reason: "mcp-connect-failed", error: error && error.message ? error.message : String(error) };
    }
    if (!interactive) {
      callback?.close();
      await closeClient(client);
      return { ok: false, reason: "mcp-auth-required" };
    }
    try {
      if (!redirected) throw new Error("MCP authorization URL was not provided");
      const callbackUrl = await callback.callbackPromise;
      const params = callbackUrl.searchParams;
      if (!provider.lastState || params.get("state") !== provider.lastState) throw new Error("MCP OAuth state mismatch");
      if (params.get("error")) throw new Error(`MCP OAuth failed: ${params.get("error")}`);
      await transport.finishAuth(params);
      callback.close();
      transport = new StreamableHTTPClientTransport(new URL(mcp.url), { authProvider: provider });
      await client.connect(transport);
      return { ok: true, client, transport, mcp, oauth: true, newlyAuthorized: true };
    } catch (authError) {
      callback.close();
      await closeClient(client);
      return { ok: false, reason: "mcp-auth-failed", error: authError && authError.message ? authError.message : String(authError) };
    }
  }
}

async function fetchMediaMcpUsage(provider, profile, options = {}) {
  const providerId = cleanMediaProviderId(provider && provider.id);
  const connected = await createConnectedClient(providerId, profile, { ...options, interactive: false });
  if (!connected.ok) {
    const status = connected.reason === "mcp-auth-required" || connected.reason === "mcp-credential-missing" ? "login" : "error";
    return {
      id: providerId,
      name: provider && provider.name ? provider.name : providerId,
      brand: provider && provider.brand,
      status,
      mcpConnected: false,
      mcpReason: connected.reason,
      error: connected.error || null,
      hint: status === "login" ? "설정에서 이 MCP 계정을 다시 연결하세요." : "MCP 사용량 조회에 실패했습니다.",
    };
  }

  try {
    const toolList = await connected.client.listTools();
    const tool = selectBalanceTool(toolList && toolList.tools, connected.mcp.balanceTools);
    if (!tool) {
      return {
        id: providerId,
        name: provider.name,
        brand: provider.brand,
        status: "error",
        mcpConnected: true,
        mcpReason: "mcp-balance-tool-unavailable",
        hint: "MCP 서버는 연결됐지만 현재 잔여량을 반환하는 호환 tool을 찾지 못했습니다.",
      };
    }
    const result = await connected.client.callTool({ name: tool.name, arguments: {} });
    const parsed = extractMcpUsage(result, providerId);
    if (!parsed || !parsed.creditBalances.length) {
      return {
        id: providerId,
        name: provider.name,
        brand: provider.brand,
        status: "error",
        mcpConnected: true,
        mcpTool: tool.name,
        mcpReason: "mcp-balance-response-unrecognized",
        hint: "MCP 잔여량 응답 형식을 해석하지 못했습니다.",
      };
    }
    return {
      id: providerId,
      name: provider.name,
      brand: provider.brand,
      status: "ok",
      plan: parsed.plan || undefined,
      remainingPct: parsed.remainingPct,
      usedPct: parsed.remainingPct == null ? null : 100 - parsed.remainingPct,
      creditBalances: parsed.creditBalances,
      extras: [{ label: "연결", value: `MCP · ${tool.name}` }],
      mcpConnected: true,
      mcpTool: tool.name,
      cacheMaxAgeMs: 10 * 60 * 1000,
    };
  } catch (error) {
    return {
      id: providerId,
      name: provider.name,
      brand: provider.brand,
      status: "error",
      mcpConnected: true,
      mcpReason: "mcp-call-failed",
      error: error && error.message ? error.message : String(error),
    };
  } finally {
    await closeClient(connected.client);
  }
}

async function authorizeMediaMcp(providerId, profile, options = {}) {
  const connected = await createConnectedClient(providerId, profile, { ...options, interactive: true });
  if (!connected.ok) return connected;
  try {
    return { ok: true, providerId, profileId: profile.id, newlyAuthorized: connected.newlyAuthorized === true };
  } finally {
    await closeClient(connected.client);
  }
}

module.exports = {
  CALLBACK_TIMEOUT_MS,
  MCP_CONNECT_TIMEOUT_MS,
  SecureOAuthProvider,
  normalizeToolName,
  toolHasNoRequiredArgs,
  selectBalanceTool,
  flatten,
  extractMcpUsage,
  createConnectedClient,
  fetchMediaMcpUsage,
  authorizeMediaMcp,
};
