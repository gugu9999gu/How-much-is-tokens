const { runApiProvider } = require("./common");
const { finiteNumber, remainingPercent } = require("../credit-balances");
const { parseTime } = require("../time");
const { stableAccountKey } = require("../account-identity");

const ID = "elevenlabs";
const NAME = "ElevenLabs";
const BRAND = "#4b6bfb";
const SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription";

function parse(json) {
  const data = json && typeof json === "object" ? json : {};
  const limit = finiteNumber(data.character_limit);
  const used = finiteNumber(data.character_count);
  if (limit == null || limit <= 0 || used == null) return null;
  const remaining = Math.max(0, limit - used);
  const remainingPct = remainingPercent(remaining, limit);
  const resetAt = parseTime(data.next_character_count_reset_unix);
  const tier = typeof data.tier === "string" && data.tier ? data.tier : undefined;
  return {
    accountKey: stableAccountKey(ID, tier || "elevenlabs"),
    plan: tier,
    remainingPct,
    usedPct: remainingPct == null ? null : 100 - remainingPct,
    resetAt,
    windows: [{
      id: "characters",
      label: "문자 사용량",
      remainingPct,
      usedPct: remainingPct == null ? null : 100 - remainingPct,
      resetAt,
      source: "elevenlabs-subscription",
    }],
    creditBalances: [{
      id: "characters",
      label: "문자",
      balance: remaining,
      used,
      limit,
      unit: "자",
      remainingPct,
      resetAt,
      source: "elevenlabs-subscription",
    }],
  };
}

const definition = {
  id: ID,
  name: NAME,
  brand: BRAND,
  vendor: "생성형 미디어",
  vendorOrder: 80,
  serviceOrder: 40,
  detail: "월간 문자 사용량",
  credentials: [{ key: "apiKey", label: "API Key", placeholder: "xi-api-key" }],
  missingHint: "설정 > 생성형 미디어 API에서 ElevenLabs API Key를 저장하세요.",
  parse,
};

function fetchUsage(_settings, _secrets, profile = null) {
  return runApiProvider(definition, {
    url: () => SUBSCRIPTION_URL,
    headers: (creds) => ({ "xi-api-key": creds.apiKey, Accept: "application/json" }),
    parse,
  }, profile);
}

module.exports = { ...definition, fetchUsage, parse };
