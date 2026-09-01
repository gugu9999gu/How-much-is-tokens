const path = require("path");
const { home, readJson } = require("../paths");
const { requestJson } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

const ID = "claude";
const NAME = "Claude";
const BRAND = "#d97757";

function credentialsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude");
  return path.join(dir, ".credentials.json");
}

function windowFrom(raw, id, label) {
  if (!raw || typeof raw !== "object") return null;
  const usedPct = raw.utilization ?? raw.used_percentage ?? raw.percent;
  if (usedPct == null) return null;
  return {
    id,
    label,
    usedPct: Number(usedPct),
    remainingPct: remainingFromUsed(Number(usedPct)),
    resetAt: parseTime(raw.resets_at),
  };
}

async function fetchUsage() {
  const file = readJson(credentialsPath());
  const oauth = file && file.claudeAiOauth;
  if (!oauth || !oauth.accessToken) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Claude Code에서 로그인한 뒤 다시 새로고침하세요.",
    };
  }

  const expired = oauth.expiresAt && oauth.expiresAt > 0 && oauth.expiresAt < Date.now() + 30_000;
  const res = await requestJson("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "User-Agent": "claude-code/2.1.201",
      "x-app": "cli",
      Accept: "application/json",
    },
  });

  if (res.status === 401 || expired) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      plan: oauth.subscriptionType || oauth.rateLimitTier,
      status: "login",
      hint: "토큰이 만료되었습니다. 터미널에서 claude 를 실행해 다시 로그인하세요.",
    };
  }
  if (!res.ok || !res.json) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: res.error || `HTTP ${res.status}`,
      hint: "Claude 사용량 API에 연결하지 못했습니다.",
    };
  }

  const data = res.json;
  const windows = [
    windowFrom(data.five_hour, "five_hour", "5시간 한도"),
    windowFrom(data.seven_day, "seven_day", "주간 한도"),
    windowFrom(data.seven_day_sonnet, "sonnet", "Sonnet 주간 한도"),
    windowFrom(data.seven_day_opus, "opus", "Opus 주간 한도"),
  ].filter(Boolean);

  const primary = windows[0] || null;
  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: oauth.rateLimitTier || oauth.subscriptionType,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
  };
}

module.exports = { id: ID, fetchUsage, windowFrom };
