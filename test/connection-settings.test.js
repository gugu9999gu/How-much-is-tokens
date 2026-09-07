const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "renderer", "connection-settings.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "connection-settings.css"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const login = fs.readFileSync(path.join(root, "lib", "credential-login.js"), "utf8");
const oauth = fs.readFileSync(path.join(root, "lib", "openrouter-oauth.js"), "utf8");
const mainIntegration = fs.readFileSync(path.join(root, "lib", "openrouter-main-integration.js"), "utf8");

assert.ok(html.includes('<script src="connection-settings.js"></script>'), "minimal connection hub must load explicitly");
assert.ok(ui.includes("계정 연결"));
assert.ok(ui.includes("키 파일이나 경로를 직접 입력하지 않고 로그인부터 시작합니다."));
assert.ok(ui.includes("고급 설정"));
assert.ok(ui.includes("API Key 직접 입력"), "manual credential fallback must remain available under advanced settings");
assert.ok(css.includes(".connection-card"));
assert.ok(css.includes(".advanced-settings"));

for (const provider of ["codex", "claude", "grok", "cursor", "copilot", "antigravity", "openrouter"]) {
  assert.ok(ui.includes(`id: "${provider}"`), `connection hub missing ${provider}`);
}

for (const provider of ["codex", "claude", "grok", "openrouter"]) {
  const line = ui.split(/\r?\n/).find((row) => row.includes(`id: "${provider}"`));
  assert.ok(line && line.includes("multi: true"), `${provider} should expose simple add-account UI`);
}

assert.ok(preload.includes("connectCredential"));
assert.ok(preload.includes("addCredentialAccount"));
assert.ok(preload.includes('ipcRenderer.invoke("connect-openrouter-oauth"'), "OpenRouter OAuth must stay behind main-process IPC");
assert.ok(!preload.includes("exchangeAuthorizationCode"), "OpenRouter API key exchange must never run in preload");
assert.ok(mainIntegration.includes("exchangeAuthorizationCode"));
assert.ok(mainIntegration.includes("saveOpenRouterProfileSecrets"));
assert.ok(mainIntegration.includes("shell.openExternal"));

assert.ok(login.includes('args: ["login"]'));
assert.ok(login.includes('args: ["auth", "login"]'));
assert.ok(login.includes('commands: ["cursor-agent", "agent"]'));
assert.ok(login.includes('commands: ["gh"]'));
assert.ok(login.includes('commands: ["agy"]'));
assert.ok(login.includes("profileEnvironment(profile)"), "isolated CLI accounts must use provider-specific environment roots");
assert.ok(!login.includes("copyFileSync"), "credential login flow must not copy authentication files");
assert.ok(!login.includes("renameSync"), "credential login flow must not swap authentication files");

assert.ok(oauth.includes('const CALLBACK_HOST = "127.0.0.1"'));
assert.ok(!oauth.includes('listen(0, "0.0.0.0"'));
assert.ok(oauth.includes("code_challenge_method"));
assert.ok(oauth.includes("code_verifier"));

assert.ok(html.includes('id="githubToken"'), "legacy PAT fallback must remain available");
assert.ok(html.includes('id="cursorCookie"'), "legacy Cursor cookie fallback must remain available");
assert.ok(html.includes('id="accountProfiles"'), "advanced raw profile editor must remain available");
assert.ok(html.includes('id="openRouterApiKey"'), "advanced OpenRouter manual key fallback must remain available");

console.log("minimal connection settings UX boundary tests passed");