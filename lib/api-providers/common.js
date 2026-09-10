const { requestJson } = require("../http");

// Load a provider's stored credential fields from the OS-backed secret store.
// Additional account profiles are isolated under mediaProfile:<provider>:<id>.
// Returns an empty object when the secure store is unavailable so providers
// degrade to a "missing" state instead of throwing.
function loadApiCreds(providerId, fields, profile = null) {
  try {
    const secrets = require("../secure-secrets");
    if (profile && profile.id) {
      return secrets.loadMediaProviderProfileSecrets(providerId, profile.id, fields) || {};
    }
    return secrets.loadApiProviderSecrets(providerId, fields) || {};
  } catch {
    return {};
  }
}

function credFields(def) {
  return (def.credentials || []).map((cred) => cred.key);
}

function trimmedCreds(def, raw = {}) {
  const out = {};
  for (const field of credFields(def)) {
    out[field] = typeof raw[field] === "string" ? raw[field].trim() : "";
  }
  return out;
}

function hasAllCreds(def, creds = {}) {
  return (def.credentials || []).every((cred) => typeof creds[cred.key] === "string" && creds[cred.key].trim());
}

function missingResult(def, profile = null) {
  return {
    id: def.id,
    name: def.name,
    brand: def.brand,
    status: "missing",
    hint: profile
      ? `${profile.label || profile.id} 계정의 ${def.name} 자격증명을 저장하세요.`
      : (def.missingHint || `설정 > 생성형 미디어 API에서 ${def.name} 자격증명을 저장하세요.`),
  };
}

function loginResult(def, error, profile = null) {
  return {
    id: def.id,
    name: def.name,
    brand: def.brand,
    status: "login",
    error: error || null,
    hint: profile
      ? `${profile.label || profile.id} 계정의 ${def.name} 인증이 거부되었습니다. 설정에서 다시 연결하세요.`
      : `${def.name} 인증이 거부되었습니다. 설정에서 API 키를 다시 저장하세요.`,
  };
}

function errorResult(def, error) {
  return {
    id: def.id,
    name: def.name,
    brand: def.brand,
    status: "error",
    error: error || `${def.name} 조회 오류`,
  };
}

function okResult(def, extra = {}) {
  return {
    id: def.id,
    name: def.name,
    brand: def.brand,
    status: "ok",
    ...extra,
  };
}

// Shared HTTP fetch scaffold: load creds, short-circuit when missing, run the
// request, and map common auth/error responses. `parse(json, res)` returns the
// provider-specific `ok` payload, or null when the body cannot be interpreted.
async function runApiProvider(def, { url, headers, parse }, profile = null) {
  const creds = trimmedCreds(def, loadApiCreds(def.id, credFields(def), profile));
  if (!hasAllCreds(def, creds)) return missingResult(def, profile);

  let res;
  try {
    res = await requestJson(url(creds), { headers: headers(creds) });
  } catch (err) {
    return errorResult(def, (err && err.message) || String(err));
  }

  if (res.status === 401 || res.status === 403) return loginResult(def, `HTTP ${res.status}`, profile);
  if (!res.ok || !res.json) return errorResult(def, res.error || (res.status ? `HTTP ${res.status}` : "연결 오류"));

  const payload = parse(res.json, res, creds);
  if (!payload) return errorResult(def, `${def.name} 응답을 해석하지 못했습니다.`);
  return okResult(def, payload);
}

module.exports = {
  requestJson,
  loadApiCreds,
  credFields,
  trimmedCreds,
  hasAllCreds,
  missingResult,
  loginResult,
  errorResult,
  okResult,
  runApiProvider,
};
