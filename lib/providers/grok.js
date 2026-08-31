const path = require("path");
const { home, exists, readJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

const ID = "grok";
const NAME = "Grok";
const BRAND = "#e8e8e8";

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
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Grok 세션이 만료되었습니다. grok 에서 다시 로그인하세요.",
    };
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: res.error || `HTTP ${res.status}`,
    };
  }

  const config = (res.json && res.json.config) || res.json || {};
  const usedPct = num(config.creditUsagePercent);
  const resetAt = parseTime(
    (config.currentPeriod && config.currentPeriod.end) || config.billingPeriodEnd,
  );
  const windows = [];
  if (usedPct != null) {
    windows.push({
      id: "weekly",
      label: "주간",
      usedPct,
      remainingPct: remainingFromUsed(usedPct),
      resetAt,
    });
  }
  for (const product of config.productUsage || []) {
    const pct = num(product.usagePercent);
    if (pct == null) continue;
    windows.push({
      id: String(product.product || "product").toLowerCase(),
      label: product.product || "상품",
      usedPct: pct,
      remainingPct: remainingFromUsed(pct),
      resetAt,
    });
  }

  const primary = windows[0] || null;
  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt,
    windows,
  };
}

module.exports = { id: ID, fetchUsage };
