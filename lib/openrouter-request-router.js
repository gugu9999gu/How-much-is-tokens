const crypto = require("crypto");
const http = require("http");
const { Readable } = require("stream");
const {
  activeOpenRouterProfiles,
  normalizeOpenRouterRouter,
} = require("./openrouter-profiles");

const LOOPBACK_HOST = "127.0.0.1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_COOLDOWN_MS = 60_000;
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000;
const NETWORK_FAILURE_COOLDOWN_MS = 15_000;
const RETRYABLE_STATUSES = new Set([401, 402, 403, 429]);
const SAFE_NETWORK_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOP_BY_HOP_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SENSITIVE_REQUEST_HEADERS = new Set([
  "api-key",
  "cookie",
  "openai-api-key",
  "x-api-key",
  "x-openai-api-key",
]);

function safeJson(res, status, payload) {
  if (res.headersSent) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(body.length));
  res.end(body);
}

function bearerToken(req) {
  const value = String((req.headers && req.headers.authorization) || "");
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : "";
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function copyRequestHeaders(headers = {}) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = String(name).toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || SENSITIVE_REQUEST_HEADERS.has(lower) || value == null) continue;
    result[lower] = value;
  }
  return result;
}

function copyResponseHeaders(headers, res) {
  if (!headers || typeof headers.forEach !== "function") return;
  headers.forEach((value, name) => {
    const lower = String(name).toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    try { res.setHeader(name, value); } catch {}
  });
}

function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === "") return DEFAULT_COOLDOWN_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1_000, Math.min(15 * 60_000, Math.round(seconds * 1000)));
  }
  const at = Date.parse(String(value));
  if (Number.isFinite(at)) return Math.max(1_000, Math.min(15 * 60_000, at - now));
  return DEFAULT_COOLDOWN_MS;
}

function retryCooldownMs(status, headers, now = Date.now()) {
  if (status === 429) {
    const retryAfter = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
    return parseRetryAfter(retryAfter, now);
  }
  if (status === 401 || status === 402 || status === 403) return AUTH_FAILURE_COOLDOWN_MS;
  return DEFAULT_COOLDOWN_MS;
}

function upstreamUrl(requestUrl, baseUrl = OPENROUTER_BASE_URL) {
  const parsed = new URL(requestUrl || "/", "http://127.0.0.1");
  if (parsed.pathname !== "/v1" && !parsed.pathname.startsWith("/v1/")) return null;
  const suffix = parsed.pathname.slice(3);
  return `${baseUrl}${suffix}${parsed.search}`;
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        const error = new Error("request-body-too-large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function candidateSort(policy, metrics) {
  if (policy !== "max-remaining") {
    return (a, b) => a.profile.priority - b.profile.priority || a.profile.id.localeCompare(b.profile.id);
  }
  return (a, b) => {
    const aRemaining = finiteNumber(metrics.get(a.profile.id) && metrics.get(a.profile.id).remainingPct);
    const bRemaining = finiteNumber(metrics.get(b.profile.id) && metrics.get(b.profile.id).remainingPct);
    if (aRemaining != null || bRemaining != null) {
      if (aRemaining == null) return 1;
      if (bRemaining == null) return -1;
      if (aRemaining !== bRemaining) return bRemaining - aRemaining;
    }
    return a.profile.priority - b.profile.priority || a.profile.id.localeCompare(b.profile.id);
  };
}

class OpenRouterRequestRouter {
  constructor(options = {}) {
    this.loadProfileSecrets = options.loadProfileSecrets || ((profileId) =>
      require("./secure-secrets").loadOpenRouterProfileSecrets(profileId));
    this.ensureLocalToken = options.ensureLocalToken || (() =>
      require("./secure-secrets").ensureLocalRouterToken());
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.now = options.now || (() => Date.now());
    this.baseUrl = options.baseUrl || OPENROUTER_BASE_URL;
    this.server = null;
    this.settings = { openRouterProfiles: [], openRouterRouter: normalizeOpenRouterRouter() };
    this.localToken = null;
    this.cooldowns = new Map();
    this.metrics = new Map();
    this.lastError = null;
  }

  updateProfileMetrics(providerResults = []) {
    const next = new Map();
    for (const provider of Array.isArray(providerResults) ? providerResults : []) {
      if (!provider || provider.providerId !== "openrouter" || !provider.profileId) continue;
      const remainingPct = finiteNumber(provider.routingRemainingPct ?? provider.remainingPct);
      next.set(provider.profileId, {
        remainingPct,
        status: provider.status || null,
        updatedAt: this.now(),
      });
    }
    this.metrics = next;
  }

  candidateProfiles() {
    const now = this.now();
    const policy = normalizeOpenRouterRouter(this.settings.openRouterRouter).policy;
    const candidates = [];
    for (const profile of activeOpenRouterProfiles(this.settings)) {
      const secrets = this.loadProfileSecrets(profile.id) || {};
      const apiKey = typeof secrets.apiKey === "string" ? secrets.apiKey.trim() : "";
      if (!apiKey) continue;
      const cooldownUntil = Number(this.cooldowns.get(profile.id) || 0);
      if (cooldownUntil > now) continue;
      candidates.push({ profile, apiKey });
    }
    return candidates.sort(candidateSort(policy, this.metrics));
  }

  markCooldown(profileId, durationMs) {
    const until = this.now() + Math.max(1_000, Number(durationMs) || DEFAULT_COOLDOWN_MS);
    this.cooldowns.set(profileId, until);
    return until;
  }

  cleanupCooldowns() {
    const now = this.now();
    for (const [profileId, until] of this.cooldowns.entries()) {
      if (Number(until) <= now) this.cooldowns.delete(profileId);
    }
  }

  status() {
    this.cleanupCooldowns();
    const router = normalizeOpenRouterRouter(this.settings.openRouterRouter);
    const address = this.server && this.server.listening ? this.server.address() : null;
    const actualPort = address && typeof address === "object" ? address.port : router.port;
    const profiles = activeOpenRouterProfiles(this.settings).map((profile) => {
      const secrets = this.loadProfileSecrets(profile.id) || {};
      const cooldownUntil = Number(this.cooldowns.get(profile.id) || 0) || null;
      const metric = this.metrics.get(profile.id) || {};
      return {
        id: profile.id,
        label: profile.label,
        priority: profile.priority,
        apiKeyConfigured: !!(typeof secrets.apiKey === "string" && secrets.apiKey.trim()),
        cooldownUntil,
        remainingPct: finiteNumber(metric.remainingPct),
      };
    });
    return {
      enabled: router.enabled,
      running: !!(this.server && this.server.listening),
      host: LOOPBACK_HOST,
      port: actualPort,
      endpoint: `http://${LOOPBACK_HOST}:${actualPort}/v1`,
      policy: router.policy,
      tokenConfigured: !!this.localToken,
      profiles,
      lastError: this.lastError,
    };
  }

  async configure(settings = {}) {
    this.settings = {
      ...settings,
      openRouterRouter: normalizeOpenRouterRouter(settings.openRouterRouter),
    };
    const router = this.settings.openRouterRouter;
    if (!router.enabled) {
      await this.stop();
      this.lastError = null;
      return this.status();
    }

    try {
      this.localToken = this.ensureLocalToken();
    } catch (err) {
      await this.stop();
      this.lastError = "secure-local-auth-unavailable";
      return this.status();
    }

    const address = this.server && this.server.listening ? this.server.address() : null;
    if (address && typeof address === "object" && address.port === router.port && address.address === LOOPBACK_HOST) {
      this.lastError = null;
      return this.status();
    }

    await this.stop();
    await this.start(router.port);
    return this.status();
  }

  start(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(() => {
          if (!res.headersSent) safeJson(res, 500, { error: { code: "local_router_error", message: "Local router request failed." } });
          else res.destroy();
        });
      });
      server.on("error", (err) => {
        this.lastError = err && err.code === "EADDRINUSE" ? "port-in-use" : "listen-failed";
        reject(err);
      });
      server.listen(port, LOOPBACK_HOST, () => {
        this.server = server;
        this.lastError = null;
        resolve(this.status());
      });
    });
  }

  stop() {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  async handleRequest(req, res) {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    if (parsed.pathname === "/health") {
      safeJson(res, 200, { ok: true, running: true });
      return;
    }

    const target = upstreamUrl(req.url, this.baseUrl);
    if (!target) {
      safeJson(res, 404, { error: { code: "unsupported_path", message: "Use the /v1 endpoint." } });
      return;
    }

    if (!this.localToken || !constantTimeEqual(bearerToken(req), this.localToken)) {
      safeJson(res, 401, { error: { code: "local_auth_required", message: "Valid local router Bearer token required." } });
      return;
    }

    let body = Buffer.alloc(0);
    try {
      body = await readBody(req);
    } catch (err) {
      if (err && err.code === "BODY_TOO_LARGE") {
        safeJson(res, 413, { error: { code: "request_too_large", message: "Request body is too large." } });
        return;
      }
      throw err;
    }

    const candidates = this.candidateProfiles();
    if (!candidates.length) {
      safeJson(res, 503, { error: { code: "no_openrouter_key_available", message: "No OpenRouter key is currently available." } });
      return;
    }

    const method = String(req.method || "GET").toUpperCase();
    const headers = copyRequestHeaders(req.headers);
    let lastReason = "all_keys_unavailable";

    for (const candidate of candidates) {
      headers.authorization = `Bearer ${candidate.apiKey}`;
      let upstream;
      try {
        const init = { method, headers };
        if (method !== "GET" && method !== "HEAD" && body.length) init.body = body;
        upstream = await this.fetchImpl(target, init);
      } catch {
        this.markCooldown(candidate.profile.id, NETWORK_FAILURE_COOLDOWN_MS);
        lastReason = "upstream_network_error";
        if (SAFE_NETWORK_RETRY_METHODS.has(method)) continue;
        safeJson(res, 502, {
          error: {
            code: "upstream_network_error",
            message: "Upstream connection failed. The request was not replayed on another key because completion state is ambiguous.",
          },
        });
        return;
      }

      if (RETRYABLE_STATUSES.has(upstream.status)) {
        this.markCooldown(candidate.profile.id, retryCooldownMs(upstream.status, upstream.headers, this.now()));
        lastReason = upstream.status === 429 ? "rate_limited" : "key_unavailable";
        try { await upstream.body?.cancel?.(); } catch {}
        continue;
      }

      res.statusCode = upstream.status;
      copyResponseHeaders(upstream.headers, res);
      res.setHeader("x-how-much-is-tokens-profile", candidate.profile.id);
      if (!upstream.body) {
        res.end();
        return;
      }

      // From this point the upstream response is committed to the client. If a
      // streaming body fails later, do not replay the request with another key.
      const stream = Readable.fromWeb(upstream.body);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }

    safeJson(res, 503, {
      error: {
        code: "all_openrouter_keys_unavailable",
        message: "All configured OpenRouter keys are temporarily unavailable.",
        reason: lastReason,
      },
    });
  }
}

module.exports = {
  LOOPBACK_HOST,
  OPENROUTER_BASE_URL,
  MAX_BODY_BYTES,
  RETRYABLE_STATUSES,
  SAFE_NETWORK_RETRY_METHODS,
  HOP_BY_HOP_HEADERS,
  SENSITIVE_REQUEST_HEADERS,
  bearerToken,
  constantTimeEqual,
  copyRequestHeaders,
  parseRetryAfter,
  retryCooldownMs,
  upstreamUrl,
  candidateSort,
  OpenRouterRequestRouter,
};
