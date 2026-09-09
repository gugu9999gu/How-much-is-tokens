const { requestJson } = require("./http");
const { cleanProfileId, normalizeOpenRouterProfiles } = require("./openrouter-profiles");

const OPENROUTER_CURRENT_KEY_URL = "https://openrouter.ai/api/v1/key";

function creatorUserIdFromPayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : (payload || {});
  const value = data.creator_user_id;
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

async function creatorUserIdForApiKey(apiKey, options = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;
  const request = options.requestJsonImpl || requestJson;
  try {
    const res = await request(OPENROUTER_CURRENT_KEY_URL, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!res || !res.ok || !res.json) return null;
    return creatorUserIdFromPayload(res.json);
  } catch {
    return null;
  }
}

async function findExistingOpenRouterAccount(profiles, creatorUserId, options = {}) {
  const target = String(creatorUserId || "").trim();
  if (!target) return null;
  const excluded = cleanProfileId(options.excludeProfileId);
  const loadProfileSecrets = options.loadProfileSecrets || (() => ({ apiKey: null }));
  const rows = normalizeOpenRouterProfiles(profiles).filter((profile) => profile.id !== excluded);

  const checks = await Promise.all(rows.map(async (profile) => {
    let secrets;
    try { secrets = loadProfileSecrets(profile.id) || {}; } catch { secrets = {}; }
    const existingCreator = await creatorUserIdForApiKey(secrets.apiKey, options);
    return existingCreator === target ? profile : null;
  }));
  return checks.find(Boolean) || null;
}

module.exports = {
  OPENROUTER_CURRENT_KEY_URL,
  creatorUserIdFromPayload,
  creatorUserIdForApiKey,
  findExistingOpenRouterAccount,
};
