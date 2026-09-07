const fs = require("fs");

const patchFile = "scripts/patch-v1.0.25-auth-manager-once.js";
let patch = fs.readFileSync(patchFile, "utf8");
patch = patch.replace(
  '  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);',
  '  if (count === 0 && label.startsWith("copilot")) return text;\n  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);',
);
fs.writeFileSync(patchFile, patch, "utf8");

const file = "lib/providers/copilot.js";
let text = fs.readFileSync(file, "utf8");
const beforeFind = `function findToken(settings, options = {}) {\n  const pasted = (settings.githubToken || "").trim();`;
const afterFind = `function findToken(settings, options = {}, oauthCredential = null) {\n  const managed = String((oauthCredential && (oauthCredential.githubAccess || oauthCredential.refresh)) || "").trim();\n  if (managed) return { token: managed, source: "앱 OAuth" };\n  const pasted = (settings.githubToken || "").trim();`;
if (!text.includes(afterFind)) {
  if (!text.includes(beforeFind)) throw new Error("current Copilot findToken shape changed");
  text = text.replace(beforeFind, afterFind);
}
const beforeFetch = `async function fetchUsage(settings) {\n  const creds = findToken(settings);`;
const afterFetch = `async function fetchUsage(settings, _secrets = {}, profile = null) {\n  if (profile && profile.oauthManaged && profile.oauthNeedsReauth) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 GitHub/Copilot 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const creds = findToken(settings, {}, profile && profile.oauthManaged ? profile.authCredential : null);`;
if (!text.includes(afterFetch)) {
  if (!text.includes(beforeFetch)) throw new Error("current Copilot fetchUsage shape changed");
  text = text.replace(beforeFetch, afterFetch);
}
fs.writeFileSync(file, text, "utf8");
console.log("Copilot OAuth-first compatibility patch prepared");