const { runApiProvider } = require("./common");
const { finiteNumber } = require("../credit-balances");

const ID = "stability";
const NAME = "Stability AI";
const BRAND = "#8b5cf6";
const BALANCE_URL = "https://api.stability.ai/v1/user/balance";

// GET /v1/user/balance -> { credits }
function parse(json) {
  const data = json && typeof json === "object" ? json : {};
  const credits = finiteNumber(data.credits);
  if (credits == null) return null;
  return {
    creditBalances: [{
      id: "credits",
      label: "크레딧",
      balance: credits,
      unit: "크레딧",
      source: "stability-balance",
    }],
  };
}

const definition = {
  id: ID,
  name: NAME,
  brand: BRAND,
  vendor: "생성형 미디어",
  vendorOrder: 80,
  serviceOrder: 50,
  detail: "크레딧 잔액",
  credentials: [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }],
  missingHint: "설정 > 생성형 미디어 API에서 Stability AI API Key를 저장하세요.",
  parse,
};

function fetchUsage() {
  return runApiProvider(definition, {
    url: () => BALANCE_URL,
    headers: (creds) => ({ Authorization: `Bearer ${creds.apiKey}`, Accept: "application/json" }),
    parse,
  });
}

module.exports = { ...definition, fetchUsage, parse };
