const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { normalizeAccountProfiles, defaultConfigDir, profileInstanceKey } = require("../lib/account-profiles");
const { sanitizeProvider, saveProviderSnapshot, applyUsageFallback, readStore } = require("../lib/usage-cache");
const {
  PROVIDER_COMMANDS,
  resolveProviderExecutable,
  interactiveStartCommand,
  launchRoutedCli,
  powershellRouterScript,
  installRouterLaunchers,
} = require("../lib/routed-launcher");

const WINDOWS_POWERSHELL_TIMEOUT_MS = 20_000;
assert.deepStrictEqual(Object.keys(PROVIDER_COMMANDS), ["codex", "claude", "grok", "cursor", "copilot", "antigravity"]);
assert.deepStrictEqual(PROVIDER_COMMANDS.copilot, ["copilot"], "Smart Routing must launch the standalone Copilot CLI");

const fakeExec = (_command, args) => {
  assert.strictEqual(args[0], "codex");
  return "C:\\Tools\\codex.cmd\r\n";
};
assert.strictEqual(resolveProviderExecutable("codex", { platform: "win32", execFileSyncImpl: fakeExec, env: {} }), "C:\\Tools\\codex.cmd");
assert.ok(interactiveStartCommand("C:\\Tools\\codex.cmd", "C:\\Windows\\System32\\cmd.exe").startsWith("start \"\""));
assert.ok(interactiveStartCommand("C:\\Tools\\copilot.exe", "cmd.exe").includes("copilot.exe"));
assert.strictEqual(interactiveStartCommand("bad\npath.cmd", "cmd.exe"), null);
assert.strictEqual(sanitizeProvider({ id: "codex", status: "ok", limitReached: true }).limitReached, true);
assert.strictEqual(sanitizeProvider({ id: "codex", status: "ok", remainingPct: 90, routingRemainingPct: 12 }).routingRemainingPct, 12);
const sanitizedManaged = sanitizeProvider({
  id: "antigravity:agm-a",
  providerId: "antigravity",
  status: "ok",
  remainingPct: 50,
  profileId: "agm-a",
  externalAccountRef: "a@example.com",
  accountEmail: "a@example.com",
  accountKey: "antigravity:abcdef0123456789",
  managedBy: "agm",
  accountOrder: 1,
});
assert.strictEqual(sanitizedManaged.profileId, "agm-a");
assert.strictEqual(sanitizedManaged.managedBy, "agm");
assert.strictEqual(sanitizedManaged.accountOrder, 1);
assert.strictEqual(sanitizedManaged.accountKey, "antigravity:abcdef0123456789");
assert.strictEqual(sanitizedManaged.externalAccountRef, undefined, "raw account email must not be persisted in usage cache");
assert.strictEqual(sanitizedManaged.accountEmail, undefined, "display identity must remain memory-only for managed Antigravity accounts");

const profiles = normalizeAccountProfiles([
  { providerId: "codex", label: "GPT 2번", configDir: path.join(os.tmpdir(), "launcher-codex-2") },
  { providerId: "cursor", label: "Cursor 2번", configDir: path.join(os.tmpdir(), "launcher-cursor-2") },
  { providerId: "copilot", label: "Copilot 2번", configDir: path.join(os.tmpdir(), "launcher-copilot-2") },
]);
const profile = profiles[0];

let captured = null;
const spawnImpl = (command, args, options) => {
  captured = { command, args, options };
  return { unref() {} };
};
const launched = launchRoutedCli("codex", profile, {
  platform: "win32", executable: "C:\\Tools\\codex.cmd", spawnImpl, comspec: "cmd.exe", cwd: "C:\\Work",
});
assert.strictEqual(launched.ok, true);
assert.strictEqual(captured.options.env.CODEX_HOME, profile.configDir);
assert.strictEqual(captured.options.detached, true);
assert.strictEqual(captured.options.windowsHide, false);
assert.strictEqual(captured.options.windowsVerbatimArguments, true);

captured = null;
assert.strictEqual(launchRoutedCli("cursor", profiles[1], {
  platform: "win32", executable: "C:\\Tools\\agent.exe", spawnImpl, comspec: "cmd.exe",
}).ok, true);
assert.strictEqual(captured.options.env.CURSOR_CONFIG_DIR, profiles[1].configDir);

captured = null;
const copilotCalls = [];
const copilotLaunch = launchRoutedCli("copilot", profiles[2], {
  platform: "win32",
  executable: "C:\\Tools\\copilot.exe",
  spawnImpl,
  comspec: "cmd.exe",
  execFileSyncImpl(command, args) {
    copilotCalls.push({ command, args });
    if (command === "where.exe" && args[0] === "gh") return "C:\\Tools\\gh.exe\r\n";
    if (command === "C:\\Tools\\gh.exe" && args[0] === "auth" && args[1] === "token") return "runtime-only-token\r\n";
    return "";
  },
});
assert.strictEqual(copilotLaunch.ok, true);
assert.strictEqual(captured.options.env.GH_CONFIG_DIR, profiles[2].configDir);
assert.strictEqual(captured.options.env.COPILOT_HOME, path.join(profiles[2].configDir, "copilot-home"));
assert.strictEqual(captured.options.env.COPILOT_GITHUB_TOKEN, "runtime-only-token", "selected profile token must be injected only into the launched process environment");
assert.ok(copilotCalls.some((call) => call.command === "C:\\Tools\\gh.exe" && call.args.join(" ") === "auth token"));
assert.ok(captured.args.join(" ").includes("copilot.exe"));
assert.ok(!captured.args.join(" ").includes("runtime-only-token"), "Copilot token must never be placed on a command line");

let agmSwitch = null;
captured = null;
const antigravityProfile = { id: "agm-b", providerId: "antigravity", label: "Antigravity 2", accountRef: "b@example.com", externalManager: "agm" };
const agLaunch = launchRoutedCli("antigravity", antigravityProfile, {
  platform: "win32", executable: "C:\\Tools\\agy.exe", agmExecutable: "C:\\Tools\\agm.exe",
  execFileSyncImpl(command, args) { agmSwitch = { command, args }; return "ok"; },
  spawnImpl, comspec: "cmd.exe",
});
assert.strictEqual(agLaunch.ok, true);
assert.strictEqual(agmSwitch.command, "C:\\Tools\\agm.exe");
assert.deepStrictEqual(agmSwitch.args, ["switch", "b@example.com", "--target", "agy"]);

captured = null;
const defaultLaunch = launchRoutedCli("codex", null, {
  platform: "win32", executable: "C:\\Tools\\codex.cmd", spawnImpl, comspec: "cmd.exe",
});
assert.strictEqual(defaultLaunch.ok, true);
assert.strictEqual(captured.options.env.CODEX_HOME, defaultConfigDir("codex"));

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-router-state-"));
const cacheFile = path.join(stateDir, "usage-cache.json");
const cacheNow = Date.now();
const cacheProvider = {
  id: "codex", accountKey: "codex:routing-test", name: "Codex", status: "ok",
  remainingPct: 55, routingRemainingPct: 55,
  windows: [{ id: "session", label: "5시간", remainingPct: 55, usedPct: 45, resetAt: cacheNow + 60_000 }],
};
assert.strictEqual(saveProviderSnapshot(cacheProvider, cacheNow, cacheFile), true);
const fallback = applyUsageFallback({ id: "codex", accountKey: "codex:routing-test", name: "Codex", status: "error", error: "network" }, cacheNow + 100, cacheFile);
assert.strictEqual(fallback.stale, true);
let routeEntry = readStore(cacheFile).providers["codex:routing-test"];
assert.strictEqual(routeEntry.routeBlockedAt, cacheNow + 100);
assert.strictEqual(saveProviderSnapshot({ ...cacheProvider, remainingPct: 54, routingRemainingPct: 54 }, cacheNow + 200, cacheFile), true);
routeEntry = readStore(cacheFile).providers["codex:routing-test"];
assert.strictEqual(Object.prototype.hasOwnProperty.call(routeEntry, "routeBlockedAt"), false);

const binDir = path.join(stateDir, "router-bin");
const installed = installRouterLaunchers({ stateDir, binDir });
assert.strictEqual(installed.ok, true);
for (const name of [
  "codex-auto.cmd", "claude-auto.cmd", "grok-auto.cmd", "cursor-auto.cmd", "copilot-auto.cmd", "antigravity-auto.cmd",
  "how-tokens-route.ps1", "README.txt",
]) assert.ok(fs.existsSync(path.join(binDir, name)), `${name} must be installed`);

const psPath = path.join(binDir, "how-tokens-route.ps1");
const ps = fs.readFileSync(psPath, "utf8");
for (const needle of [
  "settings.json", "usage-cache.json", "fixed-primary", "max-remaining", "routingRemainingPct", "routeBlockedAt",
  "provider.limitReached", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "GROK_HOME", "CURSOR_CONFIG_DIR", "GH_CONFIG_DIR",
  "COPILOT_HOME", "COPILOT_GITHUB_TOKEN", "Get-StableAccountKey", "Resolve-Agm", "$Agm switch", "$Agm list", "managedBy",
]) assert.ok(ps.includes(needle), `generated router should include ${needle}`);
assert.ok(!ps.includes("externalAccountRef"), "standalone router must not require a raw account email from usage-cache.json");

const generated = powershellRouterScript(stateDir, {
  codex: "C:\\Users\\test\\.codex",
  claude: "C:\\Users\\test\\.claude",
  grok: "C:\\Users\\test\\.grok",
  cursor: "C:\\Users\\test\\.cursor",
  copilot: "C:\\Users\\test\\AppData\\Roaming\\GitHub CLI",
  antigravity: "",
});
assert.ok(generated.includes("C:\\\\Users\\\\test\\\\.codex"));

if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-Command",
    `[scriptblock]::Create((Get-Content -Raw -LiteralPath '${psPath.replace(/'/g, "''")}')) | Out-Null`,
  ], { stdio: "inherit", windowsHide: true, timeout: WINDOWS_POWERSHELL_TIMEOUT_MS });

  const outputFile = path.join(stateDir, "selected-home.txt");
  const fakeCodex = path.join(stateDir, "fake-codex.cmd");
  fs.writeFileSync(fakeCodex, "@echo off\r\n>\"%ROUTER_TEST_OUTPUT%\" echo %CODEX_HOME%\r\nexit /b 0\r\n", "utf8");
  const fixtureNow = Date.now();
  fs.writeFileSync(path.join(stateDir, "settings.json"), JSON.stringify({
    refreshSeconds: 60,
    smartRouting: { codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 } },
    accountProfiles: [profile],
  }, null, 2));
  const profileKey = profileInstanceKey(profile);
  const fixtureCache = {
    version: 1,
    providers: {
      "codex:default-fixture": { savedAt: fixtureNow, provider: { id: "codex", name: "Codex", status: "ok", remainingPct: 90, routingRemainingPct: 0, limitReached: false } },
      [profileKey]: { savedAt: fixtureNow, provider: { id: profileKey, instanceKey: profileKey, name: "Codex", status: "ok", remainingPct: 99, routingRemainingPct: 63, limitReached: false } },
    },
  };
  fs.writeFileSync(cacheFile, JSON.stringify(fixtureCache, null, 2));

  execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath, "codex"], {
    env: { ...process.env, CODEX_BIN: fakeCodex, ROUTER_TEST_OUTPUT: outputFile }, stdio: "ignore", windowsHide: true, timeout: WINDOWS_POWERSHELL_TIMEOUT_MS,
  });
  assert.strictEqual(fs.readFileSync(outputFile, "utf8").trim().toLowerCase(), profile.configDir.toLowerCase());

  fixtureCache.providers[profileKey].routeBlockedAt = Date.now();
  fs.writeFileSync(cacheFile, JSON.stringify(fixtureCache, null, 2));
  let blocked = false;
  try {
    execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath, "codex"], {
      env: { ...process.env, CODEX_BIN: fakeCodex, ROUTER_TEST_OUTPUT: outputFile }, stdio: "ignore", windowsHide: true, timeout: WINDOWS_POWERSHELL_TIMEOUT_MS,
    });
  } catch { blocked = true; }
  assert.strictEqual(blocked, true);
}

fs.rmSync(stateDir, { recursive: true, force: true });
console.log("profile-aware routed launcher tests passed");
