const assert = require("assert");
const {
  CLI_SPECS,
  CODEX_WINDOWS_INSTALLER,
  extractVersion,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
  codexUpdateKind,
} = require("../lib/cli-maintenance");

assert.strictEqual(extractVersion("codex-cli 1.2.3"), "1.2.3");
assert.strictEqual(extractVersion("claude version v2.1.7-beta.1"), "2.1.7-beta.1");
assert.strictEqual(extractVersion("no version here"), null);
assert.strictEqual(compareVersions("1.2.3", "1.2.4"), -1);
assert.strictEqual(compareVersions("1.3.0", "1.2.9"), 1);
assert.strictEqual(compareVersions("2.0.0-beta.1", "2.0.0"), -1);
assert.strictEqual(compareVersions("2.0.0", "2.0.0"), 0);

assert.strictEqual(CLI_SPECS.codex.updateMethod, "codex-official");
assert.strictEqual(CLI_SPECS.codex.updateArgs, undefined, "Codex does not expose a documented `codex update` command");
assert.strictEqual(CODEX_WINDOWS_INSTALLER, "https://chatgpt.com/codex/install.ps1");
assert.strictEqual(codexUpdateKind("C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd", "win32"), "npm");
assert.strictEqual(codexUpdateKind("C:\\Users\\test\\.local\\bin\\codex.exe", "win32"), "windows-installer");
assert.deepStrictEqual(CLI_SPECS.claude.updateArgs, ["update"]);
assert.deepStrictEqual(CLI_SPECS.cursor.updateArgs, ["update"]);
assert.strictEqual(CLI_SPECS.cursor.autoUpdate, true);
assert.strictEqual(resolvedSpec("grokbot").sourceId, "cursor");
assert.deepStrictEqual(resolvedSpec("grokbot").commands, ["cursor-agent", "agent"]);
assert.strictEqual(resolvedSpec("openrouter"), null);

runResolvedCommand(process.execPath, ["--version"]).then((result) => {
  assert.strictEqual(result.ok, true);
  assert.ok(extractVersion(result.stdout), "Node version probe should expose a parseable version");
  return runResolvedCommand(process.execPath, ["bad arg with spaces"]);
}).then((invalid) => {
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.error, "invalid-command-arg");
  console.log("CLI maintenance tests passed");
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
