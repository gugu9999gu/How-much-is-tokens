const path = require("path");
const { home, exists, readJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

const ID = "gemini";
const NAME = "Gemini CLI";
const BRAND = "#4ea8de";

async function fetchUsage() {
  const file = path.join(home(), ".gemini", "oauth_creds.json");
  if (!exists(file)) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Gemini CLI 로그인 파일이 없습니다.",
    };
  }
  const oauth = readJson(file) || {};
  if (!oauth.access_token) {
    return { id: ID, name: NAME, brand: BRAND, status: "missing", hint: "Gemini 토큰이 없습니다." };
  }

  const headers = {
    Authorization: `Bearer ${oauth.access_token}`,
    "Content-Type": "application/json",
  };
  const loaded = await requestJson("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers,
    body: { metadata: { ideType: "IDE_UNSPECIFIED", pluginType: "GEMINI" } },
  });
  if (loaded.status === 401) {
    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "gemini 를 실행해 토큰을 갱신하세요." };
  }
  if (!loaded.ok || !loaded.json) {
    return { id: ID, name: NAME, brand: BRAND, status: "error", error: loaded.error || `HTTP ${loaded.status}` };
  }

  const project = loaded.json.cloudaicompanionProject;
  const quota = await requestJson("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
    method: "POST",
    headers,
    body: project ? { project } : {},
  });
  if (quota.status === 401) {
    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "gemini 를 실행해 토큰을 갱신하세요." };
  }
  if (!quota.ok || !quota.json) {
    return { id: ID, name: NAME, brand: BRAND, status: "error", error: quota.error || `quota HTTP ${quota.status}` };
  }

  const buckets = quota.json.buckets || [];
  const windows = buckets.map((bucket) => {
    const remainingFrac = num(bucket.remainingFraction);
    const remainingPct = remainingFrac == null ? null : Math.max(0, Math.min(100, remainingFrac * 100));
    return {
      id: bucket.modelId || "model",
      label: bucket.modelId || "모델",
      remainingPct,
      usedPct: remainingFromUsed(remainingPct),
      resetAt: parseTime(bucket.resetTime),
    };
  });
  const tightest = [...windows]
    .filter((win) => win.remainingPct != null)
    .sort((a, b) => a.remainingPct - b.remainingPct || (a.resetAt || Infinity) - (b.resetAt || Infinity))[0] || null;
  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: loaded.json.currentTier && (loaded.json.currentTier.name || loaded.json.currentTier.id),
    remainingPct: tightest ? tightest.remainingPct : null,
    usedPct: tightest ? tightest.usedPct : null,
    resetAt: tightest ? tightest.resetAt : null,
    windows,
  };
}

module.exports = { id: ID, fetchUsage };
