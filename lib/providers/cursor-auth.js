const fs = require("fs");
const path = require("path");
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

function firstExisting(paths) {
  return (Array.isArray(paths) ? paths : []).find((file) => {
    try { return !!file && fs.existsSync(file); } catch { return false; }
  }) || null;
}

function profileStateDb(profile = null) {
  if (!profile || !profile.configDir) return cursorStateDb();
  return firstExisting([
    path.join(profile.configDir, "state.vscdb"),
    path.join(profile.configDir, "User", "globalStorage", "state.vscdb"),
    path.join(profile.configDir, "globalStorage", "state.vscdb"),
  ]);
}

function profileAuthFiles(profile = null) {
  if (!profile || !profile.configDir) return cursorAuthFiles();
  return [
    path.join(profile.configDir, "auth.json"),
    path.join(profile.configDir, "credentials.json"),
    path.join(profile.configDir, ".credentials.json"),
  ].filter((file) => {
    try { return fs.existsSync(file); } catch { return false; }
  });
}

function readTokenFromSqlite(dbPath = cursorStateDb()) {
  if (!dbPath) return {};
  const rows = queryItemTable(dbPath, "cursorAuth%");
  return mapByKey(rows);
}

function readTokenFromFiles(files = cursorAuthFiles()) {
  for (const file of files) {
    const json = readJson(file);
    if (json && json.accessToken) return { "cursorAuth/accessToken": json.accessToken };
    if (json && json.token) return { "cursorAuth/accessToken": json.token };
  }
  return {};
}

function getCursorAuth(settings = {}, profile = null) {
  const configuredCookie = profile ? "" : String(settings.cursorCookie || "").trim();
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
  const dbPath = profileStateDb(profile);
  const files = profileAuthFiles(profile);
  try {
    auth = readTokenFromSqlite(dbPath);
  } catch {
    auth = readTokenFromFiles(files);
  }
  if (!auth["cursorAuth/accessToken"]) auth = { ...auth, ...readTokenFromFiles(files) };

  const token = auth["cursorAuth/accessToken"] || null;
  if (!token) return null;
  const claims = decodeJwt(token);
  const cookieValue = cookieFromJwt(token);
  return {
    token,
    cookie: `WorkosCursorSessionToken=${cookieValue}`,
    userId: claims && claims.sub ? String(claims.sub).split("|").pop() : null,
    membership: auth["cursorAuth/stripeMembershipType"] || null,
    source: profile ? "cursor-profile" : "cursor-local",
    configDir: profile && profile.configDir ? profile.configDir : null,
  };
}

module.exports = {
  decodeJwt,
  cookieFromJwt,
  tokenFromCookie,
  firstExisting,
  profileStateDb,
  profileAuthFiles,
  readTokenFromSqlite,
  readTokenFromFiles,
  getCursorAuth,
};
