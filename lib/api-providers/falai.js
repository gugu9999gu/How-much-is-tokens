const { runApiProvider } = require("./common");
const { finiteNumber } = require("../credit-balances");
const { stableAccountKey } = require("../account-identity");

const ID = "falai";
const NAME = "fal.ai";
const BRAND = "#6f5cff";
const BILLING_URL = "https://api.fal.ai/v1/account/billing?expand=credits";

// GET /v1/account/billing?expand=credits -> { username, credits: { current_balance, currency } }
function parse(json) {
  const data = json && typeof json === "object" ? json : {};
  const credits = data.credits && typeof data.credits === "object" ? data.credits : {};
  const balance = finiteNumber(credits.current_balance);
  if (balance == null) return null;
  const currency = typeof credits.currency === "string" && credits.currency
    ? credits.currency.toUpperCase()
    : "USD";
  const username = typeof data.username === "string" && data.username ? data.username : null;
  return {
    accountKey: stableAccountKey(ID, username || "fal"),
    plan: username || undefined,
    creditBalances: [{
      id: "credits",
      label: "계정 크레딧",
      balance,
      currency,
      source: "falai-billing",
    }],
  };
}

const definition = {
  id: ID,
  name: NAME,
  brand: BRAND,
  vendor: "생성형 미디어",
  vendorOrder: 80,
  serviceOrder: 10,
  detail: "계정 크레딧 잔액",
  credentials: [{ key: "apiKey", label: "API Key", placeholder: "fal API Key (Admin scope)" }],
  missingHint: "설정 > 생성형 미디어 API에서 fal.ai API Key(Admin scope)를 저장하세요.",
  parse,
};

function fetchUsage() {
  return runApiProvider(definition, {
    url: () => BILLING_URL,
    headers: (creds) => ({ Authorization: `Key ${creds.apiKey}`, Accept: "application/json" }),
    parse,
  });
}

module.exports = { ...definition, fetchUsage, parse };
