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

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function antigravityRemainingPct(raw) {
  const row = asRecord(raw);
  if (!row) return null;
  const target = asRecord(row.remaining) || row;
  const fraction = Number(target.remainingFraction);
  const percentage = Number(target.remainingPercentage);
  const remaining = Number.isFinite(fraction)
    ? fraction * 100
    : Number.isFinite(percentage)
      ? percentage * 100
      : null;
  return remaining == null ? null : Math.max(0, Math.min(100, remaining));
}

function parseAntigravitySummary(body) {
  const groups = Array.isArray(body && body.groups) ? body.groups : [];
  const windows = new Map();
  for (const rawGroup of groups) {
    const group = asRecord(rawGroup);
    if (!group) continue;
    const groupName = `${String(group.displayName || "")} ${String(group.description || "")}`.toLowerCase();
    const family = groupName.includes("gemini") ? "Gemini"
      : (groupName.includes("claude") || groupName.includes("3p") || groupName.includes("gpt")) ? "Claude/GPT"
        : String(group.displayName || "기타");
    for (const rawBucket of Array.isArray(group.buckets) ? group.buckets : []) {
      const bucket = asRecord(rawBucket);
      if (!bucket) continue;
      const remainingPct = antigravityRemainingPct(bucket);
      if (remainingPct == null) continue;
      const descriptor = `${String(bucket.window || "")} ${String(bucket.bucketId || "")} ${String(bucket.displayName || "")}`.toLowerCase();
      const suffix = descriptor.includes("week") ? "주간 한도" : (descriptor.includes("5h") || descriptor.includes("five")) ? "5시간 한도" : "한도";
      const label = `${family} ${suffix}`;
      if (windows.has(label)) continue;
      windows.set(label, {
        id: label.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-"),
        label,
        remainingPct,
        usedPct: 100 - remainingPct,
        resetAt: parseTime(bucket.resetTime),
        source: "antigravity-oauth-quota-summary",
      });
    }
  }
  return [...windows.values()];
}

function quotaInfoEntries(modelInfo) {
  const rows = [];
  const add = (value, tier = "") => {
    const row = asRecord(value);
    if (row) rows.push(tier ? { ...row, tier } : row);
  };
  if (Array.isArray(modelInfo.quotaInfo)) modelInfo.quotaInfo.forEach((value) => add(value));
  else add(modelInfo.quotaInfo);
  if (Array.isArray(modelInfo.quotaInfos)) modelInfo.quotaInfos.forEach((value) => add(value));
  const byTier = asRecord(modelInfo.quotaInfoByTier);
  if (byTier) Object.entries(byTier).forEach(([tier, value]) => {
    if (Array.isArray(value)) value.forEach((item) => add(item, tier));
    else add(value, tier);
  });
  return rows;
}

function parseAntigravityModels(body) {
  const models = asRecord(body && body.models);
  if (!models) return [];
  const windows = new Map();
  for (const [modelId, rawInfo] of Object.entries(models)) {
    const info = asRecord(rawInfo);
    if (!info) continue;
    for (const quota of quotaInfoEntries(info)) {
      const haystack = `${modelId} ${String(info.displayName || "")} ${String(quota.tier || "")}`.toLowerCase();
      const family = haystack.includes("gemini") ? "Gemini"
        : (haystack.includes("claude") || haystack.includes("opus") || haystack.includes("sonnet") || haystack.includes("gpt")) ? "Claude/GPT" : null;
      if (!family || windows.has(family)) continue;
      const remainingPct = antigravityRemainingPct(quota);
      if (remainingPct == null) continue;
      windows.set(family, {
        id: family === "Gemini" ? "gemini" : "3p",
        label: `${family} 한도`,
        remainingPct,
        usedPct: 100 - remainingPct,
        resetAt: parseTime(quota.resetTime),
        source: "antigravity-oauth-models",
      });
    }
  }
  return [...windows.values()];
}

async function antigravityOAuthRequest(url, credential) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.access}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "antigravity/ide/2.5.5",
    },
    body: JSON.stringify({ project: credential.projectId }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

async function fetchOAuthUsage(profile) {
  const credential = profile && profile.authCredential;
  if (!credential || !credential.access || !credential.projectId) {
    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Antigravity 계정은 앱에서 재인증이 필요합니다." };
  }
  const base = "https://daily-cloudcode-pa.googleapis.com";
  try {
    const summary = await antigravityOAuthRequest(`${base}/v1internal:retrieveUserQuotaSummary`, credential);
    if (summary.status === 401 || summary.status === 403) {
      return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "Antigravity OAuth 인증 갱신이 필요합니다." };
    }
    let windows = summary.ok ? parseAntigravitySummary(summary.json) : [];
    if (!windows.length) {
      const models = await antigravityOAuthRequest(`${base}/v1internal:fetchAvailableModels`, credential);
      if (models.status === 401 || models.status === 403) {
        return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "Antigravity OAuth 인증 갱신이 필요합니다." };
      }
      windows = models.ok ? parseAntigravityModels(models.json) : [];
    }
    if (!windows.length) {
      return { id: ID, name: NAME, brand: BRAND, status: "error", error: "Antigravity quota를 읽지 못했습니다." };
    }
    const primary = tightest(windows);
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "ok",
      remainingPct: primary ? primary.remainingPct : null,
      usedPct: primary ? primary.usedPct : null,
      resetAt: primary ? primary.resetAt : null,
      windows,
      extras: [{ label: "인증", value: "앱 OAuth" }],
      stale: false,
    };
  } catch (error) {
    return { id: ID, name: NAME, brand: BRAND, status: "error", error: error.message || String(error) };
  }
}

async function fetchUsage(_settings = {}, _secrets = {}, profile = null) {
  if (profile && profile.oauthManaged) {
    if (profile.oauthNeedsReauth) return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Antigravity 계정은 앱에서 재인증이 필요합니다." };
    return fetchOAuthUsage(profile);
  }
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
  antigravityRemainingPct,
  parseAntigravitySummary,
  parseAntigravityModels,
  fetchOAuthUsage,
};
