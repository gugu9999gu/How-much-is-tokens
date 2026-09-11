const {
  requestJson,
  loadApiCreds,
  trimmedCreds,
  hasAllCreds,
  missingResult,
  loginResult,
  okResult,
} = require("./common");
const { finiteNumber, remainingPercent } = require("../credit-balances");
const { stableAccountKey } = require("../account-identity");

const ID = "higgsfield";
const NAME = "Higgsfield";
const BRAND = "#22d3ee";
const ACCOUNT_URL = "https://platform.higgsfield.ai/v1/account";

function firstNumber(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n != null) return n;
  }
  return null;
}

function parse(json) {
  const data = json && typeof json === "object" ? json : {};
  const credits = data.credits && typeof data.credits === "object" ? data.credits : {};
  const subscription = data.subscription && typeof data.subscription === "object" ? data.subscription : {};
  const balance = firstNumber(
    typeof data.credits === "number" ? data.credits : undefined,
    credits.balance,
    credits.remaining,
    credits.available,
    data.balance,
    data.credits_remaining,
    subscription.credits,
    subscription.credits_remaining,
  );
  if (balance == null) return null;
  const limit = firstNumber(credits.limit, credits.total, subscription.credits_limit, data.credits_limit);
  const account = data.email || data.username || data.name || null;
  const used = limit != null ? Math.max(0, limit - balance) : null;
  return {
    account,
    creditBalance: {
      id: "credits",
      label: "크레딧",
      balance,
      used,
      limit: limit == null ? null : limit,
      unit: "크레딧",
      remainingPct: limit == null ? null : remainingPercent(balance, limit),
      source: "higgsfield-account",
    },
  };
}

const definition = {
  id: ID,
  name: NAME,
  brand: BRAND,
  vendor: "생성형 미디어",
  vendorOrder: 80,
  serviceOrder: 20,
  detail: "크레딧 · 공식 MCP 지원",
  credentials: [
    { key: "keyId", label: "API Key ID", placeholder: "HF_API_KEY_ID" },
    { key: "keySecret", label: "API Key Secret", placeholder: "HF_API_KEY_SECRET" },
  ],
  missingHint: "설정 > 생성형 미디어 API에서 Higgsfield API Key를 저장하거나 MCP 계정을 연결하세요.",
  parse,
};

async function fetchUsage(_settings, _secrets, profile = null) {
  const creds = trimmedCreds(definition, loadApiCreds(ID, ["keyId", "keySecret"], profile));
  if (!hasAllCreds(definition, creds)) return missingResult(definition, profile);

  let res;
  try {
    res = await requestJson(ACCOUNT_URL, {
      headers: {
        Authorization: `Key ${creds.keyId}:${creds.keySecret}`,
        Accept: "application/json",
      },
    });
  } catch {
    res = null;
  }

  if (res && (res.status === 401 || res.status === 403)) return loginResult(definition, `HTTP ${res.status}`, profile);

  const info = res && res.ok && res.json ? parse(res.json) : null;
  if (info) {
    return okResult(definition, {
      accountKey: stableAccountKey(ID, info.account || creds.keyId),
      accountEmail: info.account && String(info.account).includes("@") ? String(info.account) : undefined,
      accountLogin: info.account && !String(info.account).includes("@") ? String(info.account) : undefined,
      remainingPct: info.creditBalance.remainingPct,
      creditBalances: [info.creditBalance],
    });
  }

  return okResult(definition, {
    accountKey: stableAccountKey(ID, creds.keyId),
    extras: [{ label: "잔액", value: "MCP 연결 권장" }],
    note: "공개 REST 응답에서 잔액을 확인하지 못했습니다. 공식 Higgsfield MCP 계정을 연결하면 잔여 크레딧을 조회할 수 있습니다.",
  });
}

module.exports = { ...definition, fetchUsage, parse };
