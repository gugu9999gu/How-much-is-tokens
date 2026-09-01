const { readJson, exists } = require("../paths");
const { parseTime, remainingFromUsed } = require("../time");
const {
  antigravitySettingsPath,
  snapshotPath,
  ensureBridgeInstalled,
} = require("../antigravity-bridge");

const ID = "antigravity";
const NAME = "Antigravity";
const BRAND = "#7c6cff";
const STALE_AFTER_MS = 15 * 60 * 1000;

function pctFromFraction(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n * 100));
}

function bucketLabel(id) {
  const key = String(id || "").toLowerCase();
  const labels = {
    "gemini-5h": "Gemini 5시간 한도",
    "gemini-weekly": "Gemini 주간 한도",
    "3p-5h": "Claude/GPT 5시간 한도",
    "3p-weekly": "Claude/GPT 주간 한도",
  };
  return labels[key] || String(id || "Quota");
}

function resetAtFor(raw, observedAt) {
  const direct = parseTime(raw && raw.reset_time);
  if (direct) return direct;
  const seconds = Number(raw && raw.reset_in_seconds);
  const observed = parseTime(observedAt);
  if (Number.isFinite(seconds) && seconds >= 0 && observed) return observed + seconds * 1000;
  return null;
}

function windowsForAccount(account) {
  const quota = account && account.quota && typeof account.quota === "object" ? account.quota : {};
  const accountLabel = account.label || "Google account";
  return Object.entries(quota)
    .filter(([, raw]) => !(raw && raw.disabled))
    .map(([id, raw]) => {
      const remainingPct = pctFromFraction(raw && raw.remaining_fraction);
      if (remainingPct == null) return null;
      return {
        id: `${account.id || "account"}-${id}`,
        label: `${accountLabel} · ${bucketLabel(id)}`,
        remainingPct,
        usedPct: remainingFromUsed(remainingPct),
        resetAt: resetAtFor(raw, account.observedAt),
        accountId: account.id || null,
      };
    })
    .filter(Boolean);
}

function tightest(windows) {
  return [...windows]
    .filter((win) => win.remainingPct != null)
    .sort((a, b) => a.remainingPct - b.remainingPct || (a.resetAt || Infinity) - (b.resetAt || Infinity))[0] || null;
}

function aiCreditsSetting() {
  const settings = readJson(antigravitySettingsPath()) || {};
  if (settings.useG1Credits === true) return "사용";
  if (settings.useG1Credits === false) return "미사용";
  return null;
}

async function fetchUsage() {
  const bridge = ensureBridgeInstalled();
  const file = snapshotPath();

  if (!exists(file)) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: bridge.hint || "Antigravity CLI를 한 번 실행하면 공식 status-line quota가 기록됩니다.",
    };
  }

  const snapshot = readJson(file);
  const accounts = snapshot && Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  if (!accounts.length) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Antigravity status-line 데이터가 아직 없습니다. agy를 한 번 실행하세요.",
    };
  }

  const activeId = snapshot.activeAccountId || null;
  const orderedAccounts = [...accounts].sort((a, b) => {
    if (a.id === activeId && b.id !== activeId) return -1;
    if (b.id === activeId && a.id !== activeId) return 1;
    return (parseTime(b.observedAt) || 0) - (parseTime(a.observedAt) || 0);
  });

  const windows = orderedAccounts.flatMap(windowsForAccount);
  const activeWindows = windows.filter((win) => !activeId || win.accountId === activeId);
  const primary = tightest(activeWindows.length ? activeWindows : windows);
  const activeAccount = orderedAccounts.find((account) => account.id === activeId) || orderedAccounts[0];
  const observedAt = parseTime(activeAccount && activeAccount.observedAt);
  const stale = !observedAt || Date.now() - observedAt > STALE_AFTER_MS;
  const plan = activeAccount && activeAccount.plan ? activeAccount.plan : null;

  const extras = [{ label: "Google 계정", value: `${orderedAccounts.length}개` }];
  const credits = aiCreditsSetting();
  if (credits) extras.push({ label: "AI Credits", value: credits });

  if (!windows.length) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "ok",
      plan,
      remainingPct: null,
      usedPct: null,
      resetAt: null,
      windows: [],
      extras,
      stale,
    };
  }

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan,
    remainingPct: primary ? primary.remainingPct : null,
    usedPct: primary ? primary.usedPct : null,
    resetAt: primary ? primary.resetAt : null,
    windows,
    extras,
    stale,
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  bucketLabel,
  windowsForAccount,
};
