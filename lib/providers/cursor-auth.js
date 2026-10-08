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

function userIdFromToken(token) {
  const claims = decodeJwt(token);
  return claims && claims.sub ? String(claims.sub).split("|").pop() : null;
}

function readCursorProfileRow(profile = null) {
  let row = {};
  try {
    row = readTokenFromSqlite(profileStateDb(profile)) || {};
  } catch {
    row = {};
  }
  if (!row["cursorAuth/accessToken"]) row = { ...row, ...readTokenFromFiles(profileAuthFiles(profile)) };
  let scoped = row["cursorAuth/cachedScopedProfile"];
  if (typeof scoped === "string") {
    try { scoped = JSON.parse(scoped); } catch { scoped = null; }
  }
  const email = typeof row["cursorAuth/cachedEmail"] === "string" ? row["cursorAuth/cachedEmail"].trim() : "";
  const displayName = scoped && typeof scoped.displayName === "string" ? scoped.displayName.trim() : "";
  return {
    row,
    email: email || null,
    displayName: displayName || null,
    membership: row["cursorAuth/stripeMembershipType"] || null,
    userId: userIdFromToken(row["cursorAuth/accessToken"]),
  };
}

function withLocalCursorIdentity(auth, profile = null) {
  if (!auth) return auth;
  const local = readCursorProfileRow(profile);
  const sameAccount = !local.userId || !auth.userId || local.userId === auth.userId;
  if (!sameAccount) return auth;
  return {
    ...auth,
    email: auth.email || local.email || null,
    displayName: auth.displayName || local.displayName || null,
    membership: auth.membership || local.membership || null,
  };
}

function getCursorAuth(settings = {}, profile = null) {
  const configuredCookie = profile ? "" : String(settings.cursorCookie || "").trim();
  if (configuredCookie) {
    const token = tokenFromCookie(configuredCookie);
    const cookie = configuredCookie.startsWith("WorkosCursorSessionToken=")
      ? configuredCookie
      : `WorkosCursorSessionToken=${configuredCookie}`;
    return withLocalCursorIdentity({
      token,
      cookie,
      userId: userIdFromToken(token),
      membership: null,
      email: null,
      displayName: null,
      source: "settings",
    }, null);
  }

  const stored = readCursorProfileRow(profile);
  const token = stored.row["cursorAuth/accessToken"] || null;
  if (!token) return null;
  const cookieValue = cookieFromJwt(token);
  return {
    token,
    cookie: `WorkosCursorSessionToken=${cookieValue}`,
    userId: userIdFromToken(token),
    membership: stored.membership,
    email: stored.email,
    displayName: stored.displayName,
    source: profile ? "cursor-profile" : "cursor-local",
    configDir: profile && profile.configDir ? profile.configDir : null,
  };
}

function replacementCursorAuth(rejectedAuth, localAuth, options = {}) {
  if (options.profile) return null;
  if (!options.configuredCookie) return null;
  if (!rejectedAuth || !localAuth) return null;
  if (!rejectedAuth.userId || !localAuth.userId || rejectedAuth.userId !== localAuth.userId) return null;
  if (!localAuth.cookie || localAuth.cookie === rejectedAuth.cookie) return null;
  return localAuth;
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
  replacementCursorAuth,
};
