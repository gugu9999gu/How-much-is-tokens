const path = require("path");
const { home, exists, readJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { amountFromMinor, remainingPercent } = require("../credit-balances");

const ID = "grok";
const NAME = "Grok";
const BRAND = "#e8e8e8";

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

  return {
    usedPct,
    remainingPct: usedPct == null ? null : 100 - usedPct,
    resetAt,
    windows,
    extras,
    creditBalances: grokCreditBalances(config),
    products,
    usageSource,
    plan: root.subscriptionTier || root.subscription_tier || config.subscriptionTier || config.subscription_tier,
  };
}

function pickAuth() {
  const file = readJson(path.join(home(), ".grok", "auth.json"));
  if (!file || typeof file !== "object") return null;
  const now = Date.now();
  const entries = Object.entries(file);
  const ranked = [
    ...entries.filter(([key]) => key.includes("auth.x.ai")),
    ...entries.filter(([key]) => key.includes("accounts.x.ai")),
    ...entries,
  ];
  const seen = new Set();
  for (const [key, value] of ranked) {
    if (seen.has(key) || !value || typeof value !== "object") continue;
    seen.add(key);
    if (value.auth_mode === "web_login" || value.auth_mode === "api_key") continue;
    if (value.expires_at && Date.parse(value.expires_at) < now) continue;
    const token = value.key || value.access_token;
    if (!token) continue;
    return { token, userId: value.user_id };
  }
  return null;
}

async function fetchUsage() {
  const auth = pickAuth();
  if (!auth) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Grok CLI에 로그인되어 있지 않습니다.",
    };
  }

  const accountKey = stableAccountKey(ID, auth.userId);
  const versionFile = path.join(home(), ".grok", ".metadata_version");
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
    extras: parsed.extras,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  parseBillingPayload,
  normalizeProducts,
  periodMeta,
  grokCreditBalances,
  centValue,
};
