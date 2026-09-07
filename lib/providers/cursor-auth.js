const { readJson, cursorStateDb, cursorAuthFiles } = require("../paths");
const { queryItemTable, mapByKey } = require("../sqlite");

function decodeJwt(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function cookieFromJwt(token) {
  const claims = decodeJwt(token);
  const sub = String((claims && claims.sub) || "");
  const uid = sub.includes("|") ? sub.split("|").pop() : sub;
  if (uid) return `${uid}%3A%3A${token}`;
  return token;
}

function tokenFromCookie(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  if (value.startsWith("WorkosCursorSessionToken=")) value = value.slice("WorkosCursorSessionToken=".length);
  try { value = decodeURIComponent(value); } catch {}
  if (value.includes("::")) value = value.split("::").pop();
  return value && value.split(".").length >= 3 ? value : null;
}

function readTokenFromSqlite() {
  const dbPath = cursorStateDb();
  if (!dbPath) return {};
  const rows = queryItemTable(dbPath, "cursorAuth%");
  return mapByKey(rows);
}

function readTokenFromFiles() {
  for (const file of cursorAuthFiles()) {
    const json = readJson(file);
    if (json && json.accessToken) return { "cursorAuth/accessToken": json.accessToken };
  }
  return {};
}

function getCursorAuth(settings = {}, oauthCredential = null) {
  if (oauthCredential && oauthCredential.access) {
    const token = String(oauthCredential.access);
    const claims = decodeJwt(token);
    const cookieValue = cookieFromJwt(token);
    return {
      token,
      cookie: `WorkosCursorSessionToken=${cookieValue}`,
      userId: oauthCredential.accountId || (claims && claims.sub ? String(claims.sub).split("|").pop() : null),
      membership: null,
      source: "app-oauth",
    };
  }
  const configuredCookie = String(settings.cursorCookie || "").trim();
  if (configuredCookie) {
    const token = tokenFromCookie(configuredCookie);
    const cookie = configuredCookie.startsWith("WorkosCursorSessionToken=")
      ? configuredCookie
      : `WorkosCursorSessionToken=${configuredCookie}`;
    const claims = decodeJwt(token);
    return {
      token,
      cookie,
      userId: claims && claims.sub ? String(claims.sub).split("|").pop() : null,
      membership: null,
      source: "settings",
    };
  }

  let auth = {};
  try {
    auth = readTokenFromSqlite();
  } catch {
    auth = readTokenFromFiles();
  }
  if (!auth["cursorAuth/accessToken"]) auth = { ...auth, ...readTokenFromFiles() };

  const token = auth["cursorAuth/accessToken"] || null;
  if (!token) return null;
  const claims = decodeJwt(token);
  const cookieValue = cookieFromJwt(token);
  return {
    token,
    cookie: `WorkosCursorSessionToken=${cookieValue}`,
    userId: claims && claims.sub ? String(claims.sub).split("|").pop() : null,
    membership: auth["cursorAuth/stripeMembershipType"] || null,
    source: "cursor-local",
  };
}

module.exports = {
  decodeJwt,
  cookieFromJwt,
  tokenFromCookie,
  getCursorAuth,
};
