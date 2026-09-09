const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  LOGIN_SPECS,
  PROFILE_LOGIN_PROVIDERS,
  preferredWindowsCommand,
  resolveCommand,
  interactiveLoginCommand,
  launchCredentialLogin,
  nextManagedProfile,
} = require("../lib/credential-login");

assert.deepStrictEqual([...PROFILE_LOGIN_PROVIDERS].sort(), ["claude", "codex", "copilot", "cursor", "grok"]);
assert.deepStrictEqual(LOGIN_SPECS.codex.args, ["login"]);
assert.deepStrictEqual(LOGIN_SPECS.claude.args, ["auth", "login"]);
assert.deepStrictEqual(LOGIN_SPECS.grok.args, ["login"]);
assert.deepStrictEqual(LOGIN_SPECS.cursor.commands, ["cursor-agent", "agent"], "Cursor must prefer the unambiguous cursor-agent binary");
assert.deepStrictEqual(LOGIN_SPECS.copilot.args, ["auth", "login"]);
assert.deepStrictEqual(LOGIN_SPECS.antigravity.args, []);

assert.strictEqual(
  preferredWindowsCommand([
    "C:\\Users\\test\\AppData\\Roaming\\npm\\codex",
    "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd",
  ]),
  "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd",
  "Windows command resolution must prefer a runnable npm .cmd shim over the extensionless POSIX shim",
);
assert.strictEqual(
  preferredWindowsCommand([
    "C:\\Tools\\cursor-agent.cmd",
    "C:\\Tools\\cursor-agent.exe",
  ]),
  "C:\\Tools\\cursor-agent.exe",
  "native Windows executables should be preferred over command shims",
);

const resolved = resolveCommand(["cursor-agent", "agent"], {
  platform: "win32",
  env: {},
  execFileSyncImpl(command, args) {
    assert.strictEqual(command, "where.exe");
    if (args[0] === "cursor-agent") return "C:\\Tools\\cursor-agent.exe\r\n";
    return "";
  },
});
assert.strictEqual(resolved, "C:\\Tools\\cursor-agent.exe");

const npmShimResolved = resolveCommand(["codex"], {
  platform: "win32",
  env: {},
  execFileSyncImpl(command, args) {
    assert.strictEqual(command, "where.exe");
    assert.deepStrictEqual(args, ["codex"]);
    return "C:\\Users\\test\\AppData\\Roaming\\npm\\codex\r\nC:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd\r\n";
  },
});
assert.strictEqual(npmShimResolved, "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd");

const commandLine = interactiveLoginCommand("C:\\Tools\\claude.exe", ["auth", "login"], "C:\\Windows\\System32\\cmd.exe");
assert.ok(commandLine.includes('start "" "C:\\Windows\\System32\\cmd.exe" /d /k'));
assert.ok(commandLine.includes('call "C:\\Tools\\claude.exe" auth login'));
assert.strictEqual(interactiveLoginCommand("bad\npath", ["login"], "cmd.exe"), null);
assert.strictEqual(interactiveLoginCommand("tool.exe", ["bad arg"], "cmd.exe"), null);

if (process.platform === "win32") {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-login-quoting-"));
  try {
    const shim = path.join(smokeRoot, "login shim.cmd");
    const marker = path.join(smokeRoot, "marker.txt");
    fs.writeFileSync(shim, "@echo off\r\n> \"%~dp0marker.txt\" echo %1\r\nexit /b 0\r\n", "utf8");
    const shell = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    const smokeCommand = interactiveLoginCommand(shim, ["login"], shell)
      .replace('start "" ', 'start "" /wait ')
      .replace(" /d /k call ", " /d /c call ");
    const smoke = spawnSync(shell, ["/d", "/s", "/c", smokeCommand], {
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 8_000,
    });
    assert.ifError(smoke.error);
    assert.strictEqual(smoke.status, 0, `Windows quoted START smoke failed: ${smoke.stderr || smoke.stdout || "unknown error"}`);
    assert.strictEqual(fs.readFileSync(marker, "utf8").trim(), "login");
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "how-tokens-managed-profiles-"));
try {
  const existingAccount2 = path.join(root, "codex", "account-2");
  const proposal = nextManagedProfile({
    accountProfiles: [{ providerId: "codex", label: "Codex 2", configDir: existingAccount2 }],
  }, "codex", { rootDir: root });
  assert.strictEqual(proposal.label, "Codex 3");
  assert.strictEqual(proposal.configDir, path.join(root, "codex", "account-3"));

  fs.mkdirSync(path.join(root, "codex", "account-3"), { recursive: true });
  const collisionSafe = nextManagedProfile({
    accountProfiles: [{ providerId: "codex", label: "Codex 2", configDir: existingAccount2 }],
  }, "codex", { rootDir: root });
  assert.strictEqual(collisionSafe.label, "Codex 4");
  assert.strictEqual(collisionSafe.configDir, path.join(root, "codex", "account-4"));
  const cursorProposal = nextManagedProfile({}, "cursor", { rootDir: root });
  const copilotProposal = nextManagedProfile({}, "copilot", { rootDir: root });
  assert.strictEqual(cursorProposal.label, "Cursor 2");
  assert.strictEqual(copilotProposal.label, "Copilot 2");
  assert.strictEqual(nextManagedProfile({}, "antigravity", { rootDir: root }), null,
    "Antigravity multi-account storage is handled by the encrypted external manager rather than raw profile directories");

  let spawnCall = null;
  const profile = {
    id: "profile-test",
    providerId: "codex",
    label: "Codex 2",
    configDir: existingAccount2,
  };
  const launched = launchCredentialLogin("codex", profile, {
    platform: "win32",
    executable: "C:\\Tools\\codex.exe",
    comspec: "C:\\Windows\\System32\\cmd.exe",
    spawnImpl(command, args, options) {
      spawnCall = { command, args, options };
      return { unref() {} };
    },
  });
  assert.strictEqual(launched.ok, true);
  assert.strictEqual(launched.profileId, "profile-test");
  assert.strictEqual(spawnCall.options.env.CODEX_HOME, profile.configDir, "isolated login must set CODEX_HOME instead of moving auth files");
  assert.strictEqual(spawnCall.options.detached, true);
  assert.strictEqual(spawnCall.options.windowsHide, false);
  assert.strictEqual(spawnCall.options.windowsVerbatimArguments, true);
  assert.deepStrictEqual(spawnCall.args.slice(0, 3), ["/d", "/s", "/c"]);

  spawnCall = null;
  const cursorProfile = { id: "cursor-test", providerId: "cursor", label: "Cursor 2", configDir: cursorProposal.configDir };
  assert.strictEqual(launchCredentialLogin("cursor", cursorProfile, {
    platform: "win32", executable: "C:\\Tools\\agent.exe", comspec: "cmd.exe",
    spawnImpl(command, args, options) { spawnCall = { command, args, options }; return { unref() {} }; },
  }).ok, true);
  assert.strictEqual(spawnCall.options.env.CURSOR_CONFIG_DIR, cursorProfile.configDir);

  spawnCall = null;
  const copilotProfile = { id: "copilot-test", providerId: "copilot", label: "Copilot 2", configDir: copilotProposal.configDir };
  assert.strictEqual(launchCredentialLogin("copilot", copilotProfile, {
    platform: "win32", executable: "C:\\Tools\\gh.exe", comspec: "cmd.exe",
    spawnImpl(command, args, options) { spawnCall = { command, args, options }; return { unref() {} }; },
  }).ok, true);
  assert.strictEqual(spawnCall.options.env.GH_CONFIG_DIR, copilotProfile.configDir);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const missing = launchCredentialLogin("claude", null, {
  platform: "win32",
  execFileSyncImpl: () => "",
});
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.reason, "cli-not-found");

console.log("provider credential login launcher tests passed");
