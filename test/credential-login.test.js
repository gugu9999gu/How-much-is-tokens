const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  LOGIN_SPECS,
  PROFILE_LOGIN_PROVIDERS,
  resolveCommand,
  interactiveLoginCommand,
  launchCredentialLogin,
  nextManagedProfile,
} = require("../lib/credential-login");

assert.deepStrictEqual([...PROFILE_LOGIN_PROVIDERS].sort(), ["claude", "codex", "grok"]);
assert.deepStrictEqual(LOGIN_SPECS.codex.args, ["login"]);
assert.deepStrictEqual(LOGIN_SPECS.claude.args, ["auth", "login"]);
assert.deepStrictEqual(LOGIN_SPECS.grok.args, ["login"]);
assert.deepStrictEqual(LOGIN_SPECS.cursor.commands, ["cursor-agent", "agent"], "Cursor must prefer the unambiguous cursor-agent binary");
assert.deepStrictEqual(LOGIN_SPECS.copilot.args, ["auth", "login"]);
assert.deepStrictEqual(LOGIN_SPECS.antigravity.args, []);

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

const commandLine = interactiveLoginCommand("C:\\Tools\\claude.exe", ["auth", "login"], "C:\\Windows\\System32\\cmd.exe");
assert.ok(commandLine.includes('call "C:\\Tools\\claude.exe" auth login'));
assert.strictEqual(interactiveLoginCommand("bad\npath", ["login"], "cmd.exe"), null);
assert.strictEqual(interactiveLoginCommand("tool.exe", ["bad arg"], "cmd.exe"), null);

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
  assert.strictEqual(nextManagedProfile({}, "cursor", { rootDir: root }), null);

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
  assert.strictEqual(spawnCall.options.detached, true, "interactive login must run independently from the widget process");
  assert.strictEqual(spawnCall.options.windowsHide, false, "interactive login console must stay visible on Windows");
  assert.ok(spawnCall.args.join(" ").includes("login"));
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