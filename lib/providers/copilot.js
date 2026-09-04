const fs = require("fs");
const { copilotAuthFiles, ghHostsFile, readJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { remainingPercent } = require("../credit-balances");

const ID = "copilot";
const NAME = "Copilot";
const BRAND = "#2f81f7";

function tokenFromJsonFile(filePath) {
  const data = readJson(filePath);
  if (!data || typeof data !== "object") return null;
  for (const [host, entry] of Object.entries(data)) {
    if (host.includes("github.com") && entry && entry.oauth_token) return entry.oauth_token;
  }
  return null;
}

function tokenFromGhHosts(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    let inGithub = false;
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (!/^[ \t]/.test(line)) {
        inGithub = line.split(":")[0].trim().replace(/"/g, "") === "github.com";
        continue;
      }
      if (inGithub && line.trim().startsWith("oauth_token:")) {
        return line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "") || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findToken(settings) {
  const pasted = (settings.githubToken || "").trim();
  if (pasted) return { token: pasted, source: "설정" };
  for (const file of copilotAuthFiles()) {
    const token = tokenFromJsonFile(file);
    if (token) return { token, source: file };
  }
  const gh = ghHostsFile();
  if (gh) {
    const token = tokenFromGhHosts(gh);
    if (token) return { token, source: gh };
  }
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    if (process.env[name]) return { token: process.env[name], source: `$${name}` };
  }
  return null;
}

function quotaWindow(snap, id, label, resetAt) {
  if (!snap || typeof snap !== "object") return null;
  if (snap.unlimited || snap.entitlement === -1 || snap.remaining === -1) {
    return { id, label, remainingPct: 100, usedPct: 0, unlimited: true, resetAt };
  }
  if (snap.entitlement === 0) return null;
  let remainingPct = num(snap.percent_remaining);
  const entitlement = num(snap.entitlement);
  const remaining = num(snap.remaining);
  if (remainingPct == null && entitlement && remaining != null) {
    remainingPct = (remaining / entitlement) * 100;
  }
  if (remainingPct == null) return null;
  return {
    id,
    label,
    remainingPct,
    usedPct: remainingFromUsed(remainingPct),
    remaining,
    entitlement,
    resetAt,
  };
}

function premiumRequestBalance(snap, resetAt) {
  if (!snap || typeof snap !== "object") return null;
  if (snap.unlimited || snap.entitlement === -1 || snap.remaining === -1) {
    return {
      id: "premium-requests",
      label: "프리미엄 요청",
      balance: null,
      used: null,
      limit: null,
      unit: "요청",
      remainingPct: 100,
      resetAt,
      unlimited: true,
      source: "copilot-quota-snapshot",
    };
  }
  const limit = num(snap.entitlement);
  const balance = num(snap.remaining);
  if (limit == null || limit <= 0 || balance == null) return null;
  const used = Math.max(0, limit - balance);
  return {
    id: "premium-requests",
    label: "프리미엄 요청",
    balance: Math.max(0, balance),
    used,
    limit,
    unit: "요청",
    remainingPct: remainingPercent(balance, limit),
    resetAt,
    source: "copilot-quota-snapshot",
  };
}

async function fetchUsage(settings) {
  const creds = findToken(settings);
  if (!creds) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "VS Code / Copilot 로그인 파일을 찾지 못했습니다. 설정에 GitHub 토큰을 붙여넣으세요.",
    };
  }

  const headersList = [
    {
      Authorization: `token ${creds.token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "User-Agent": "GitHubCopilotChat/0.35.0",
      "X-Github-Api-Version": "2025-04-01",
    },
    {
      Authorization: `Bearer ${creds.token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.107.0",
    },
  ];

  let res = null;
  for (const headers of headersList) {
    res = await requestJson("https://api.github.com/copilot_internal/user", { headers });
    if (res.status !== 401) break;
  }

  if (res.status === 401) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "GitHub 토큰이 거부되었습니다. 새 토큰을 설정에 넣어주세요.",
    };
  }
  if (res.status === 403 || res.status === 404) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "이 계정에 Copilot 구독이 없거나 토큰 권한이 부족합니다.",
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

  const data = res.json;
  const accountKey = stableAccountKey(ID, data.login || data.github_login || data.user_id || data.userId || null);
  const resetAt = parseTime(data.quota_reset_date_utc || data.quota_reset_date);
  const snaps = data.quota_snapshots || {};
  const windows = [
    quotaWindow(snaps.premium_interactions, "premium", "프리미엄", resetAt),
    quotaWindow(snaps.chat, "chat", "채팅", resetAt),
    quotaWindow(snaps.completions, "completions", "자동완성", resetAt),
  ].filter(Boolean);
  const primary = windows.find((w) => w.id === "premium") || windows[0] || null;
  const premiumBalance = premiumRequestBalance(snaps.premium_interactions, resetAt);

  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan: data.copilot_plan,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt,
    windows,
    creditBalances: premiumBalance ? [premiumBalance] : [],
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  quotaWindow,
  premiumRequestBalance,
};
