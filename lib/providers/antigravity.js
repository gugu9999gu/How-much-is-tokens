const { readJson, exists } = require("../paths");
const { parseTime, remainingFromUsed } = require("../time");
const {
  antigravitySettingsPath,
  snapshotPath,
  ensureBridgeInstalled,
} = require("../antigravity-bridge");
const { fetchLiveUsage } = require("../antigravity-cli");

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
        source: "antigravity-statusline",
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

function snapshotContext() {
  const file = snapshotPath();
  if (!exists(file)) {
    return {
      hasSnapshot: false,
      orderedAccounts: [],
      activeId: null,
      activeAccount: null,
      windows: [],
      plan: null,
      stale: true,
    };
  }

  const snapshot = readJson(file);
  const accounts = snapshot && Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  const activeId = snapshot && snapshot.activeAccountId ? snapshot.activeAccountId : null;
  const orderedAccounts = [...accounts].sort((a, b) => {
    if (a.id === activeId && b.id !== activeId) return -1;
    if (b.id === activeId && a.id !== activeId) return 1;
    return (parseTime(b.observedAt) || 0) - (parseTime(a.observedAt) || 0);
  });
  const activeAccount = orderedAccounts.find((account) => account.id === activeId) || orderedAccounts[0] || null;
  const observedAt = parseTime(activeAccount && activeAccount.observedAt);
  const windows = orderedAccounts.flatMap(windowsForAccount);

  return {
    hasSnapshot: orderedAccounts.length > 0,
    orderedAccounts,
    activeId,
    activeAccount,
    windows,
    plan: activeAccount && activeAccount.plan ? activeAccount.plan : null,
    stale: !observedAt || Date.now() - observedAt > STALE_AFTER_MS,
  };
}

function buildExtras(context, live) {
  const extras = [];
  if (context.orderedAccounts.length) extras.push({ label: "Google 계정", value: `${context.orderedAccounts.length}개` });
  const credits = aiCreditsSetting();
  if (credits) extras.push({ label: "AI Credits", value: credits });
  if (live && live.ok) extras.push({ label: "Quota 갱신", value: "자동" });
  return extras;
}

function missingHint(live, bridge) {
  if (live && live.reason === "cli-too-old") return live.hint;
  if (live && live.reason === "usage-command-failed") {
    return "Antigravity 로그인 세션을 사용할 수 없습니다. agy에서 한 번 로그인한 뒤 다시 새로고침하세요.";
  }
  if (live && live.reason === "cli-missing") return "Antigravity CLI(agy)를 설치한 뒤 다시 새로고침하세요.";
  return (bridge && bridge.hint) || "Antigravity CLI에 로그인한 뒤 다시 새로고침하세요.";
}

async function fetchUsage() {
  const bridge = ensureBridgeInstalled();
  const [live, context] = await Promise.all([
    fetchLiveUsage(),
    Promise.resolve(snapshotContext()),
  ]);

  if (live.ok && live.windows.length) {
    const primary = tightest(live.windows);
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "ok",
      plan: context.plan,
      remainingPct: primary ? primary.remainingPct : null,
      usedPct: primary ? primary.usedPct : null,
      resetAt: primary ? primary.resetAt : null,
      windows: live.windows,
      extras: buildExtras(context, live),
      stale: false,
    };
  }

  if (context.hasSnapshot) {
    const activeWindows = context.windows.filter((win) => !context.activeId || win.accountId === context.activeId);
    const primary = tightest(activeWindows.length ? activeWindows : context.windows);
    const extras = buildExtras(context, live);
    if (live.reason === "cli-too-old") extras.push({ label: "자동 갱신", value: "agy 1.1.11+ 필요" });

    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "ok",
      plan: context.plan,
      remainingPct: primary ? primary.remainingPct : null,
      usedPct: primary ? primary.usedPct : null,
      resetAt: primary ? primary.resetAt : null,
      windows: context.windows,
      extras,
      stale: context.stale,
    };
  }

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "missing",
    hint: missingHint(live, bridge),
  };
}

module.exports = {
  id: ID,
  fetchUsage,
  bucketLabel,
  windowsForAccount,
  tightest,
  snapshotContext,
};
