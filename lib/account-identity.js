const crypto = require("crypto");

function stableAccountKey(providerId, rawId) {
  const provider = String(providerId || "unknown").trim().toLowerCase() || "unknown";
  const identity = rawId == null ? "" : String(rawId).trim();
  if (!identity) return `${provider}:default`;
  const digest = crypto
    .createHash("sha256")
    .update(`${provider}\0${identity}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${provider}:${digest}`;
}

function shortAccountRef(accountKey) {
  const value = String(accountKey || "");
  const suffix = value.split(":").pop() || "";
  return suffix === "default" ? null : suffix.slice(0, 6);
}

module.exports = { stableAccountKey, shortAccountRef };
