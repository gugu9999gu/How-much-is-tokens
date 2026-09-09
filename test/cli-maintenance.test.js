const assert = require("assert");
const {
  CLI_SPECS,
  extractVersion,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
} = require("../lib/cli-maintenance");

assert.strictEqual(extractVersion("codex-cli 1.2.3"), "1.2.3");
assert.strictEqual(extractVersion("claude version v2.1.7-beta.1"), "2.1.7-beta.1");
assert.strictEqual(extractVersion("no version here"), null);
assert.strictEqual(compareVersions("1.2.3", "1.2.4"), -1);
assert.strictEqual(compareVersions("1.3.0", "1.2.9"), 1);
assert.strictEqual(compareVersions("2.0.0-beta.1", "2.0.0"), -1);
assert.strictEqual(compareVersions("2.0.0", "2.0.0"), 0);

assert.deepStrictEqual(CLI_SPECS.codex.updateArgs, ["update"]);
assert.deepStrictEqual(CLI_SPECS.claude.updateArgs, ["update"]);
assert.deepStrictEqual(CLI_SPECS.cursor.updateArgs, ["update"]);
assert.strictEqual(CLI_SPECS.cursor.autoUpdate, true);
assert.strictEqual(resolvedSpec("grokbot").sourceId, "cursor");
assert.deepStrictEqual(resolvedSpec("grokbot").commands, ["cursor-agent", "agent"]);
assert.strictEqual(resolvedSpec("openrouter"), null);

runResolvedCommand(process.execPath, ["-e", "console.log('1.2.3')"]).then((result) => {
  assert.strictEqual(result.ok, true);
  assert.ok(result.stdout.includes("1.2.3"));
  return runResolvedCommand(process.execPath, ["bad arg with spaces"]);
}).then((invalid) => {
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.error, "invalid-command-arg");
  console.log("CLI maintenance tests passed");
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
