const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { normalizeAccountProfiles, defaultConfigDir } = require("../lib/account-profiles");
const {
  resolveProviderExecutable,
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
assert.strictEqual(captured.options.windowsHide, false);
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
assert.ok(ps.includes("priority-fallback"));
assert.ok(ps.includes("max-remaining"));
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
}

fs.rmSync(stateDir, { recursive: true, force: true });
console.log("profile-aware routed launcher tests passed");
