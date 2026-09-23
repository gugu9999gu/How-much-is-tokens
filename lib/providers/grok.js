const path = require("path");
const { home, exists, readJson, writeJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { amountFromMinor, remainingPercent } = require("../credit-balances");
const { billingCycle } = require("../billing-cycle");

const ID = "grok";
const NAME = "Grok";
const BRAND = "#e8e8e8";
const DEFAULT_OIDC_ISSUER = "https://auth.x.ai";
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
const refreshLocks = new Map();

function grokConfigDir(profile = null) {
  if (profile && profile.configDir) return profile.configDir;
  return process.env.GROK_HOME || path.join(home(), ".grok");
}

function clampPct(value) {
  const parsed = num(value);
  if (parsed == null) return null;
  return Math.max(0, Math.min(100, parsed));
}

function formatPct(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function centValue(value) {
  if (value == null) return null;
  if (typeof value === "object") return amountFromMinor(value.val ?? value.value ?? value.amount_minor ?? value.amountMinor, value.exponent ?? 2);
  return amountFromMinor(value, 2);
}

function normalizeProducts(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((product) => {
      const usedPct = clampPct(product && (product.usagePercent ?? product.usage_percent));
      if (usedPct == null) return null;
      return {
        name: String((product && (product.product || product.name)) || "상품"),
        usedPct,
      };
    })
    .filter(Boolean);
}

function periodMeta(periodType) {
  if (periodType.includes("monthly")) return { id: "monthly", label: "월간 공유 한도" };
  if (periodType.includes("weekly")) return { id: "weekly", label: "주간 공유 한도" };
  return { id: "shared", label: "공유 한도" };
}

function grokCreditBalances(config) {
  if (!config || typeof config !== "object") return [];
  const balances = [];
  const prepaid = centValue(config.prepaidBalance ?? config.prepaid_balance);
  if (prepaid != null) {
    balances.push({
      id: "prepaid",
      label: "선불 크레딧",
      balance: Math.max(0, prepaid),
      used: null,
      limit: null,
      currency: "USD",
      remainingPct: null,
      resetAt: null,
      source: "grok-prepaid-balance",
    });
  }

  const cap = centValue(config.onDemandCap ?? config.on_demand_cap);
  const used = centValue(config.onDemandUsed ?? config.on_demand_used);
  if (cap != null || used != null) {
    const normalizedCap = cap == null ? null : Math.max(0, cap);
    const normalizedUsed = used == null ? null : Math.max(0, used);
    const balance = normalizedCap != null && normalizedUsed != null ? Math.max(0, normalizedCap - normalizedUsed) : null;
    balances.push({
      id: "on-demand",
      label: "On-demand 한도",
      balance,
      used: normalizedUsed,
      limit: normalizedCap,
      currency: "USD",
      remainingPct: remainingPercent(balance, normalizedCap),
      resetAt: parseTime(config.billingPeriodEnd || config.billing_period_end || (config.currentPeriod && config.currentPeriod.end)),
      source: "grok-on-demand",
    });
  }
  return balances;
}

function parseBillingPayload(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const config = root.config && typeof root.config === "object" ? root.config : root;
  const period = config.currentPeriod || config.current_period || {};
  const periodType = String(period.type || "").toLowerCase();
  const resetAt = parseTime(
    period.end || period.resetAt || config.billingPeriodEnd || config.billing_period_end,
  );
  const products = normalizeProducts(config.productUsage || config.product_usage);

  // xAI reports one shared included-credit pool. productUsage rows are a
  // breakdown of how much each surface contributed to that same pool; they
  // are NOT independent quotas.
  let usedPct = clampPct(config.creditUsagePercent ?? config.credit_usage_percent);
  let usageSource = usedPct == null ? null : "creditUsagePercent";

  if (usedPct == null && products.length > 0) {
    usedPct = Math.max(0, Math.min(100, products.reduce((sum, product) => sum + product.usedPct, 0)));
    usageSource = "productUsage-sum";
  }

  if (usedPct == null && (periodType || period.start || period.end)) {
    usedPct = 0;
    usageSource = "empty-current-period";
  }

  const windows = [];
  if (usedPct != null) {
    const meta = periodMeta(periodType);
    windows.push({
      id: meta.id,
      label: meta.label,
      usedPct,
      remainingPct: 100 - usedPct,
      resetAt,
      source: usageSource,
    });
  }

  const extras = products.map((product) => ({
    label: product.name,
    value: `사용 ${formatPct(product.usedPct)}%`,
  }));
  const billing = billingCycle({
    renewsAt: resetAt,
    startedAt: period.start || period.start_at || period.startAt,
    label: periodType.includes("monthly") ? "결제일" : "이용 기간",
    source: "grok-billing-period",
  });

  return {
    usedPct,
    remainingPct: usedPct == null ? null : 100 - usedPct,
    resetAt,
    windows,
    extras,
    creditBalances: grokCreditBalances(config),
    billing,
    products,
    usageSource,
    plan: root.subscriptionTier || root.subscription_tier || config.subscriptionTier || config.subscription_tier,
  };
}

function authFilePath(profile = null) {
  return path.join(grokConfigDir(profile), "auth.json");
}

function rankedAuthEntries(file) {
  if (!file || typeof file !== "object") return [];
  const entries = Object.entries(file).filter(([, value]) => value && typeof value === "object");
  const preferred = entries.filter(([key]) => key.includes("auth.x.ai"));
  const accounts = entries.filter(([key]) => key.includes("accounts.x.ai") && !preferred.some(([item]) => item === key));
  const rest = entries.filter(([key]) => !preferred.some(([item]) => item === key) && !accounts.some(([item]) => item === key));
  return [...preferred, ...accounts, ...rest];
}

function tokenExpiry(value) {
  if (!value || !value.expires_at) return null;
  const parsed = Date.parse(value.expires_at);
  return Number.isFinite(parsed) ? parsed : null;
}

function accessToken(value) {
  if (!value || typeof value !== "object") return "";
  return value.key || value.access_token || "";
}

function isIgnoredAuth(value) {
  return !value || value.auth_mode === "web_login" || value.auth_mode === "api_key";
}

function pickAuth(profile = null, now = Date.now()) {
  const selected = selectFreshAuth(readJson(authFilePath(profile)), now);
  if (!selected) return null;
  return { token: selected.token, userId: selected.userId };
}

function selectFreshAuth(file, now = Date.now()) {
  for (const [entryKey, value] of rankedAuthEntries(file)) {
    if (isIgnoredAuth(value)) continue;
    const token = accessToken(value);
    if (!token) continue;
    const expires = tokenExpiry(value);
    if (expires != null && expires <= now + TOKEN_REFRESH_SKEW_MS) continue;
    return { entryKey, value, token, userId: value.user_id || null };
  }
  return null;
}

function selectRefreshableAuth(file) {
  for (const [entryKey, value] of rankedAuthEntries(file)) {
    if (isIgnoredAuth(value)) continue;
    if (!value.refresh_token || !value.oidc_client_id) continue;
    return { entryKey, value };
  }
  return null;
}

function hasStoredGrokLogin(file) {
  return rankedAuthEntries(file).some(([, value]) => !isIgnoredAuth(value) && (accessToken(value) || value.refresh_token));
}

async function refreshAuthEntry(filePath, selected, requestImpl, now = Date.now()) {
  const issuer = String(selected.value.oidc_issuer || DEFAULT_OIDC_ISSUER).replace(/\/$/, "");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: String(selected.value.refresh_token),
    client_id: String(selected.value.oidc_client_id),
  });
  const res = await requestImpl(`${issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    timeoutMs: 12000,
  });
  const payload = res && res.json;
  const nextToken = payload && (payload.access_token || payload.key);
  if (!res || !res.ok || !nextToken) return null;

  const expiresIn = Number(payload.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(now + expiresIn * 1000).toISOString()
    : selected.value.expires_at;
  const current = readJson(filePath);
  if (!current || !current[selected.entryKey]) return null;
  current[selected.entryKey] = {
    ...current[selected.entryKey],
    key: nextToken,
    refresh_token: payload.refresh_token || current[selected.entryKey].refresh_token,
    expires_at: expiresAt,
  };
  writeJson(filePath, current);
  return {
    token: nextToken,
    userId: current[selected.entryKey].user_id || null,
  };
}

async function ensureGrokAuth(profile = null, options = {}) {
  const now = Number(options.now) || Date.now();
  const requestImpl = options.requestJson || requestJson;
  const filePath = options.authFile || authFilePath(profile);
  const fresh = selectFreshAuth(readJson(filePath), now);
  if (fresh) return { token: fresh.token, userId: fresh.userId };

  const refreshable = selectRefreshableAuth(readJson(filePath));
  if (!refreshable) return null;
  const pending = refreshLocks.get(filePath);
  if (pending) return pending;

  const task = refreshAuthEntry(filePath, refreshable, requestImpl, now)
    .catch(() => null)
    .finally(() => refreshLocks.delete(filePath));
  refreshLocks.set(filePath, task);
  return task;
}

async function fetchUsage(_settings = {}, _secrets = {}, profile = null) {
  const auth = await ensureGrokAuth(profile);
  if (!auth) {
    const storedLogin = hasStoredGrokLogin(readJson(authFilePath(profile)));
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: storedLogin ? "login" : "missing",
      hint: storedLogin
        ? "Grok 세션이 만료되었습니다. grok 에서 다시 로그인하세요. 마지막 잔여량은 유지됩니다."
        : (profile
          ? "이 Grok 프로필에 로그인 정보가 없습니다. 해당 GROK_HOME에서 Grok CLI 로그인을 실행하세요."
          : "Grok CLI에 로그인되어 있지 않습니다."),
    };
  }

  const accountKey = stableAccountKey(ID, auth.userId);
  const versionFile = path.join(grokConfigDir(profile), ".metadata_version");
  const version = exists(versionFile) ? require("fs").readFileSync(versionFile, "utf8").trim() : "1.0.5";
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-version": version,
    "x-grok-client-mode": "interactive",
    Accept: "application/json",
  };
  if (auth.userId) headers["x-userid"] = auth.userId;

  const res = await requestJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { headers });
  if (res.status === 401 || res.status === 403) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Grok 세션이 만료되었습니다. grok 에서 다시 로그인하세요.",
    };
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: res.error || `HTTP ${res.status}`,
    };
  }

  const parsed = parseBillingPayload(res.json);
  const primary = parsed.windows[0] || null;
  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: parsed.plan,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: parsed.resetAt,
    windows: parsed.windows,
    creditBalances: parsed.creditBalances,
    billing: parsed.billing,
    extras: parsed.extras,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  grokConfigDir,
  authFilePath,
  pickAuth,
  selectFreshAuth,
  selectRefreshableAuth,
  ensureGrokAuth,
  refreshAuthEntry,
  parseBillingPayload,
  normalizeProducts,
  periodMeta,
  grokCreditBalances,
  centValue,
};
