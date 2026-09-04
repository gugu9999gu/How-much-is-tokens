const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  normalizeAccountProfiles,
  defaultConfigDir,
  profileInstanceKey,
} = require("../lib/account-profiles");
const {
  sanitizeProvider,
  saveProviderSnapshot,
  applyUsageFallback,
  readStore,
} = require("../lib/usage-cache");
const {
  resolveProviderExecutable,
  interactiveStartCommand,
  launchRoutedCli,
  powershellRouterScript,
  installRouterLaunchers,
} = require("../lib/routed-launcher");

const fakeExec = (_command, args) => {
  assert.strictEqual(args[0], "codex");
  return "C:\\Tools\\codex.cmd\r\n";
};
assert.strictEqual(
  resolveProviderExecutable("codex", { platform: "win32", execFileSyncImpl: fakeExec, env: {} }),
  "C:\\Tools\\codex.cmd",
);
assert.ok(interactiveStartCommand("C:\\Tools\\codex.cmd", "C:\\Windows\\System32\\cmd.exe").startsWith("start \"\""));
assert.ok(interactiveStartCommand("C:\\Tools\\codex.cmd", "C:\\Windows\\System32\\cmd.exe").includes(" /k call "));
assert.strictEqual(interactiveStartCommand("bad\npath.cmd", "cmd.exe"), null, "shell paths with line breaks must be rejected");
assert.strictEqual(sanitizeProvider({ id: "codex", status: "ok", limitReached: true }).limitReached, true,
  "persistent cache must retain the server-classified reached state used by terminal routing");

const profile = normalizeAccountProfiles([
  { providerId: "codex", label: "GPT 2번", configDir: path.join(os.tmpdir(), "launcher-codex-2") },
])[0];

let captured = null;
const spawnImpl = (command, args, options) => {
  captured = { command, args, options };
  return { unref() {} };
};
const launched = launchRoutedCli("codex", profile, {
  platform: "win32",
  executable: "C:\\Tools\\codex.cmd",
  spawnImpl,
  comspec: "cmd.exe",
  cwd: "C:\\Work",
});
assert.strictEqual(launched.ok, true);
assert.strictEqual(launched.accountLabel, "GPT 2번");
assert.strictEqual(captured.command, "cmd.exe");
assert.strictEqual(captured.options.env.CODEX_HOME, profile.configDir);
assert.strictEqual(captured.options.detached, true);
assert.strictEqual(captured.options.windowsHide, true, "only the short-lived parent shell should be hidden");
assert.ok(captured.args.join(" ").includes("start \"\""), "parent shell must START a separate interactive console");
assert.ok(captured.args.join(" ").includes(" /k call "), "interactive console must stay open while the CLI runs");
assert.ok(captured.args.join(" ").includes("codex.cmd"));

captured = null;
const defaultLaunch = launchRoutedCli("codex", null, {
  platform: "win32",
  executable: "C:\\Tools\\codex.cmd",
  spawnImpl,
  comspec: "cmd.exe",
});
assert.strictEqual(defaultLaunch.ok, true);
assert.strictEqual(captured.options.env.CODEX_HOME, defaultConfigDir("codex"), "default selection must not inherit an unrelated shell CODEX_HOME");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-router-state-"));
const cacheFile = path.join(stateDir, "usage-cache.json");
const cacheNow = Date.now();
const cacheProvider = {
  id: "codex",
  accountKey: "codex:routing-test",
  name: "Codex",
  status: "ok",
  remainingPct: 55,
  windows: [{ id: "session", label: "5시간", remainingPct: 55, usedPct: 45, resetAt: cacheNow + 60_000 }],
};
assert.strictEqual(saveProviderSnapshot(cacheProvider, cacheNow, cacheFile), true);
const fallback = applyUsageFallback({
  id: "codex",
  accountKey: "codex:routing-test",
  name: "Codex",
  status: "error",
  error: "network",
}, cacheNow + 100, cacheFile);
assert.strictEqual(fallback.stale, true);
let routeEntry = readStore(cacheFile).providers["codex:routing-test"];
assert.strictEqual(routeEntry.routeBlockedAt, cacheNow + 100, "last-good quota must be route-blocked after a live error");
assert.strictEqual(routeEntry.lastLiveStatus, "error");
assert.strictEqual(saveProviderSnapshot({ ...cacheProvider, remainingPct: 54 }, cacheNow + 200, cacheFile), true);
routeEntry = readStore(cacheFile).providers["codex:routing-test"];
assert.strictEqual(Object.prototype.hasOwnProperty.call(routeEntry, "routeBlockedAt"), false,
  "a successful provider refresh must clear the standalone routing block");

const binDir = path.join(stateDir, "router-bin");
const installed = installRouterLaunchers({ stateDir, binDir });
assert.strictEqual(installed.ok, true);
for (const name of ["codex-auto.cmd", "claude-auto.cmd", "grok-auto.cmd", "how-tokens-route.ps1", "README.txt"]) {
  assert.ok(fs.existsSync(path.join(binDir, name)), `${name} must be installed`);
}

const psPath = path.join(binDir, "how-tokens-route.ps1");
const ps = fs.readFileSync(psPath, "utf8");
assert.ok(ps.includes("settings.json"));
assert.ok(ps.includes("usage-cache.json"));
assert.ok(ps.includes("fixed-primary"));
assert.ok(ps.includes("max-remaining"));
assert.ok(ps.includes("Sort-Object Order"), "default routing branch must preserve account priority order");
assert.ok(ps.includes("$Remaining -gt $Threshold"), "automatic routing must enforce the configured threshold");
assert.ok(ps.includes("routeBlockedAt"), "terminal routing must reject accounts whose latest live check failed");
assert.ok(ps.includes("provider.limitReached"), "terminal routing must reject persisted limit-reached accounts");
assert.ok(ps.includes("CODEX_HOME"));
assert.ok(ps.includes("CLAUDE_CONFIG_DIR"));
assert.ok(ps.includes("GROK_HOME"));
assert.ok(ps.includes(String(defaultConfigDir("codex")).replace(/'/g, "''")));

const generated = powershellRouterScript(stateDir, {
  codex: "C:\\Users\\test\\.codex",
  claude: "C:\\Users\\test\\.claude",
  grok: "C:\\Users\\test\\.grok",
});
assert.ok(generated.includes("C:\\Users\\test\\.codex"));

if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `[scriptblock]::Create((Get-Content -Raw -LiteralPath '${psPath.replace(/'/g, "''")}')) | Out-Null`,
  ], { stdio: "ignore", windowsHide: true, timeout: 5_000 });

  const outputFile = path.join(stateDir, "selected-home.txt");
  const fakeCodex = path.join(stateDir, "fake-codex.cmd");
  fs.writeFileSync(fakeCodex, "@echo off\r\n>\"%ROUTER_TEST_OUTPUT%\" echo %CODEX_HOME%\r\nexit /b 0\r\n", "utf8");

  const fixtureNow = Date.now();
  fs.writeFileSync(path.join(stateDir, "settings.json"), JSON.stringify({
    refreshSeconds: 60,
    smartRouting: {
      codex: { enabled: true, policy: "priority-fallback", thresholdPct: 0 },
    },
    accountProfiles: [profile],
  }, null, 2));
  const profileKey = profileInstanceKey(profile);
  const fixtureCache = {
    version: 1,
    providers: {
      "codex:default-fixture": {
        savedAt: fixtureNow,
        provider: { id: "codex", name: "Codex", status: "ok", remainingPct: 0, limitReached: false },
      },
      [profileKey]: {
        savedAt: fixtureNow,
        provider: {
          id: profileKey,
          instanceKey: profileKey,
          name: "Codex",
          status: "ok",
          remainingPct: 63,
          limitReached: false,
        },
      },
    },
  };
  fs.writeFileSync(cacheFile, JSON.stringify(fixtureCache, null, 2));

  execFileSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    psPath,
    "codex",
  ], {
    env: { ...process.env, CODEX_BIN: fakeCodex, ROUTER_TEST_OUTPUT: outputFile },
    stdio: "ignore",
    windowsHide: true,
    timeout: 5_000,
  });
  assert.strictEqual(fs.readFileSync(outputFile, "utf8").trim().toLowerCase(), profile.configDir.toLowerCase(),
    "standalone priority routing must select the next usable profile and inject CODEX_HOME");

  fixtureCache.providers[profileKey].routeBlockedAt = Date.now();
  fs.writeFileSync(cacheFile, JSON.stringify(fixtureCache, null, 2));
  let blocked = false;
  try {
    execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      psPath,
      "codex",
    ], {
      env: { ...process.env, CODEX_BIN: fakeCodex, ROUTER_TEST_OUTPUT: outputFile },
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000,
    });
  } catch {
    blocked = true;
  }
  assert.strictEqual(blocked, true, "standalone routing must fail closed when every automatic candidate is exhausted or route-blocked");
}

fs.rmSync(stateDir, { recursive: true, force: true });
console.log("profile-aware routed launcher tests passed");
