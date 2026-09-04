const { randomUUID } = require("crypto");
const { getCursorAuth } = require("./cursor-auth");
const { requestJson, num, pick } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");
const { stableAccountKey } = require("../account-identity");
const { amountFromMinor, remainingPercent } = require("../credit-balances");

const ID = "grokbot";
const NAME = "Grok Bot";
const BRAND = "#d6d6d6";
const BACKEND = "https://api2.cursor.sh";

function obfuscate(bytes) {
  let previous = 165;
  for (let i = 0; i < bytes.length; i += 1) {
    const current = bytes[i] || 0;
    bytes[i] = ((current ^ previous) + (i % 256)) & 255;
    previous = bytes[i];
  }
  return bytes;
}

function cursorChecksum(machineId, now = Date.now()) {
  const key = Math.floor(now / 1e6);
  const bytes = new Uint8Array([
    (key >> 40) & 255,
    (key >> 32) & 255,
    (key >> 24) & 255,
    (key >> 16) & 255,
    (key >> 8) & 255,
    key & 255,
  ]);
  return Buffer.from(obfuscate(bytes)).toString("base64url") + machineId;
}

async function callDashboard(method, token) {
  const machineId = randomUUID();
  return requestJson(`${BACKEND}/aiserver.v1.DashboardService/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-cursor-checksum": cursorChecksum(machineId),
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": "0.1.0",
      "x-sand-box-namespace": "prod",
      "x-ghost-mode": "true",
      "x-request-id": randomUUID(),
    },
    body: {},
  });
}

function clampPct(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

function parseSandUsage(data) {
  if (!data || typeof data !== "object") return null;
  const usedPct = clampPct(data.usagePercent);
  const resetAt = parseTime(data.nextResetTimestampUtc || data.nextResetTimestamp || data.resetAt);
  return {
    usedPct,
    remainingPct: usedPct == null ? null : remainingFromUsed(usedPct),
    resetAt,
    hasAvailableUsage: data.hasAvailableUsage == null ? null : !!data.hasAvailableUsage,
  };
}

function cents(value) {
  const n = num(value);
  return n == null ? null : n;
}

function parsePeriodUsage(data) {
  if (!data || typeof data !== "object") return null;
  const spend = data.spendLimitUsage && typeof data.spendLimitUsage === "object" ? data.spendLimitUsage : null;
  const used = spend ? cents(spend.individualUsed != null ? spend.individualUsed : spend.totalSpend) : null;
  const limit = spend ? cents(spend.individualLimit) : null;
  const remaining = spend ? cents(spend.individualRemaining) : null;
  const resetAt = parseTime(data.billingCycleEnd || data.periodEnd || data.resetAt);
  let usedPct = null;
  if (used != null && limit != null && limit > 0) usedPct = Math.max(0, Math.min(100, (used / limit) * 100));
  return {
    used,
    limit,
    remaining,
    usedPct,
    remainingPct: usedPct == null ? null : remainingFromUsed(usedPct),
    resetAt,
    plan: pick(data, "membershipType", "subscriptionTier", "planTier"),
  };
}

function periodCreditBalance(period) {
  if (!period || (period.used == null && period.limit == null && period.remaining == null)) return null;
  const used = amountFromMinor(period.used, 2);
  const limit = amountFromMinor(period.limit, 2);
  let balance = amountFromMinor(period.remaining, 2);
  if (balance == null && limit != null && used != null) balance = Math.max(0, limit - used);
  return {
    id: "on-demand",
    label: "On-demand 크레딧",
    balance: balance == null ? null : Math.max(0, balance),
    used: used == null ? null : Math.max(0, used),
    limit: limit == null ? null : Math.max(0, limit),
    currency: "USD",
    remainingPct: remainingPercent(balance, limit),
    resetAt: period.resetAt,
    source: "cursor-grokbot-period",
  };
}

function resultFromPayloads(sandData, periodData) {
  const sand = parseSandUsage(sandData);
  const period = parsePeriodUsage(periodData);
  const windows = [];

  if (sand && sand.usedPct != null) {
    windows.push({
      id: "weekly",
      label: "주간",
      usedPct: sand.usedPct,
      remainingPct: sand.remainingPct,
      resetAt: sand.resetAt,
    });
  }
  if (period && period.usedPct != null) {
    windows.push({
      id: "on-demand",
      label: "On-demand 한도",
      usedPct: period.usedPct,
      remainingPct: period.remainingPct,
      resetAt: period.resetAt,
    });
  }

  const extras = [];
  if (sand && sand.hasAvailableUsage != null) {
    extras.push({ label: "주간 사용", value: sand.hasAvailableUsage ? "가능" : "소진" });
  }
  extras.push({ label: "계정", value: "Cursor" });

  const primary = windows.find((window) => window.id === "weekly") || windows[0] || null;
  const credit = periodCreditBalance(period);
  return {
    plan: period && period.plan ? period.plan : null,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : (period && period.resetAt),
    windows,
    creditBalances: credit ? [credit] : [],
    extras,
  };
}

async function fetchUsage(settings) {
  const auth = getCursorAuth(settings || {});
  if (!auth || !auth.token) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Grok Bot은 Cursor 계정 사용량을 사용합니다. Cursor 또는 Grok Bot에 로그인하세요.",
    };
  }

  const accountKey = stableAccountKey(ID, auth.userId);
  const [sand, period] = await Promise.all([
    callDashboard("GetSandUsageStatus", auth.token),
    callDashboard("GetCurrentPeriodUsage", auth.token),
  ]);

  if ([sand.status, period.status].includes(401) || [sand.status, period.status].includes(403)) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Cursor/Grok Bot 세션이 만료되었습니다. 앱에 다시 로그인하세요.",
    };
  }

  const sandData = sand.ok && sand.json ? sand.json : null;
  const periodData = period.ok && period.json ? period.json : null;
  if (!sandData && !periodData) {
    return {
      id: ID,
      accountKey,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: sand.error || period.error || `Grok Bot usage HTTP ${sand.status}/${period.status}`,
    };
  }

  const parsed = resultFromPayloads(sandData, periodData);
  return {
    id: ID,
    accountKey,
    name: NAME,
    brand: BRAND,
    status: "ok",
    ...parsed,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  cursorChecksum,
  parseSandUsage,
  parsePeriodUsage,
  periodCreditBalance,
  resultFromPayloads,
};
