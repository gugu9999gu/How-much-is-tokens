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
// Higgsfield's public API is generation-only; a credit-balance endpoint is not
// documented. We try a best-effort account lookup and parse tolerantly. When
// the balance is not exposed we still report the connection as active and point
// the user at the dashboard/CLI instead of surfacing a hard error.
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
  detail: "크레딧 (공개 잔액 API 제한적)",
  credentials: [
    { key: "keyId", label: "API Key ID", placeholder: "HF_API_KEY_ID" },
    { key: "keySecret", label: "API Key Secret", placeholder: "HF_API_KEY_SECRET" },
  ],
  missingHint: "설정 > 생성형 미디어 API에서 Higgsfield API Key ID/Secret을 저장하세요.",
  parse,
};

async function fetchUsage() {
  const creds = trimmedCreds(definition, loadApiCreds(ID, ["keyId", "keySecret"]));
  if (!hasAllCreds(definition, creds)) return missingResult(definition);

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

  if (res && (res.status === 401 || res.status === 403)) return loginResult(definition, `HTTP ${res.status}`);

  const info = res && res.ok && res.json ? parse(res.json) : null;
  if (info) {
    return okResult(definition, {
      accountKey: stableAccountKey(ID, info.account || creds.keyId),
      remainingPct: info.creditBalance.remainingPct,
      creditBalances: [info.creditBalance],
    });
  }

  // Credentials are stored but the public API did not return a readable
  // balance. Report the connection as active and defer the number to the
  // official dashboard/CLI rather than inventing one.
  return okResult(definition, {
    accountKey: stableAccountKey(ID, creds.keyId),
    extras: [{ label: "잔액", value: "대시보드/CLI 확인" }],
    note: "공개 잔액 API가 없어 잔액은 higgsfield.ai 또는 CLI에서 확인하세요.",
  });
}

module.exports = { ...definition, fetchUsage, parse };
