const assert = require("assert");
const {
  CLI_SPECS,
  CODEX_WINDOWS_INSTALLER,
  GROK_WINDOWS_INSTALLER,
  CURSOR_WINDOWS_INSTALLER,
  ANTIGRAVITY_WINDOWS_INSTALLER,
  ANTIGRAVITY_WINDOWS_MANIFEST,
  extractVersion,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
  codexUpdateKind,
  copilotUpdateKind,
  versionFromCursorInstaller,
  versionFromGithubRelease,
  versionFromManifest,
  latestVersionFor,
} = require("../lib/cli-maintenance");

assert.strictEqual(extractVersion("codex-cli 1.2.3"), "1.2.3");
assert.strictEqual(extractVersion("claude version v2.1.7-beta.1"), "2.1.7-beta.1");
assert.strictEqual(extractVersion("agent 2026.08.04-aaa8809"), "2026.08.04-aaa8809");
assert.strictEqual(extractVersion("no version here"), null);
assert.strictEqual(compareVersions("1.2.3", "1.2.4"), -1);
assert.strictEqual(compareVersions("1.3.0", "1.2.9"), 1);
assert.strictEqual(compareVersions("2.0.0-beta.1", "2.0.0"), -1);
assert.strictEqual(compareVersions("2026.08.03-aaa", "2026.08.04-bbb"), -1);
assert.strictEqual(compareVersions("2.0.0", "2.0.0"), 0);

assert.strictEqual(CLI_SPECS.codex.updateMethod, "codex-official");
assert.strictEqual(CLI_SPECS.codex.updateArgs, undefined);
assert.strictEqual(CODEX_WINDOWS_INSTALLER, "https://chatgpt.com/codex/install.ps1");
assert.strictEqual(GROK_WINDOWS_INSTALLER, "https://x.ai/cli/install.ps1");
assert.strictEqual(CURSOR_WINDOWS_INSTALLER, "https://cursor.com/install?win32=true");
assert.strictEqual(ANTIGRAVITY_WINDOWS_INSTALLER, "https://antigravity.google/cli/install.ps1");
assert.ok(ANTIGRAVITY_WINDOWS_MANIFEST.includes("manifests/windows_amd64.json"));

assert.deepStrictEqual(CLI_SPECS.grok.latestCommand, ["update", "--check"], "Grok latest-version detection must use its documented updater command");
assert.deepStrictEqual(CLI_SPECS.grok.updateArgs, ["update"]);
assert.deepStrictEqual(CLI_SPECS.copilot.commands, ["copilot"], "Copilot maintenance must target the standalone Copilot CLI, not the legacy gh extension");
assert.strictEqual(CLI_SPECS.copilot.npmPackage, "@github/copilot");
assert.strictEqual(CLI_SPECS.copilot.updateMethod, "copilot-official");
assert.strictEqual(CLI_SPECS.copilot.autoUpdate, true);
assert.strictEqual(CLI_SPECS.antigravity.updateMethod, "powershell-installer");
assert.strictEqual(CLI_SPECS.antigravity.autoUpdate, true);
assert.deepStrictEqual(CLI_SPECS.claude.updateArgs, ["update"]);
assert.deepStrictEqual(CLI_SPECS.cursor.updateArgs, ["update"]);
assert.strictEqual(CLI_SPECS.cursor.autoUpdate, true);
assert.strictEqual(resolvedSpec("grokbot").sourceId, "cursor");
assert.deepStrictEqual(resolvedSpec("grokbot").commands, ["cursor-agent", "agent"]);
assert.strictEqual(resolvedSpec("openrouter"), null);

assert.strictEqual(versionFromCursorInstaller("$version = '2026.08.04-aaa8809'"), "2026.08.04-aaa8809");
assert.strictEqual(versionFromGithubRelease(JSON.stringify({ tag_name: "v2.82.1" })), "2.82.1");
assert.strictEqual(versionFromManifest(JSON.stringify({ version: "1.2.3", url: "https://example.invalid/agy.exe" })), "1.2.3");
assert.strictEqual(versionFromManifest(JSON.stringify({ url: "https://storage.example/1.4.5/windows_amd64/agy.exe" })), "1.4.5");

assert.strictEqual(codexUpdateKind("C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd", "win32"), "npm");
assert.strictEqual(codexUpdateKind("C:\\Users\\test\\.local\\bin\\codex.exe", "win32"), "windows-installer");
assert.strictEqual(copilotUpdateKind("C:\\Users\\test\\AppData\\Roaming\\npm\\copilot.cmd", "win32"), "npm");
assert.strictEqual(copilotUpdateKind("C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\copilot.exe", "win32"), "winget");
assert.strictEqual(copilotUpdateKind("C:\\Tools\\copilot.exe", "win32"), null, "unknown install methods must not expose an unsafe update button");

Promise.all([
  latestVersionFor(CLI_SPECS.cursor, { fetchTextImpl: async () => "$version = '2026.09.01-bbbbbbb'" }),
  latestVersionFor(CLI_SPECS.antigravity, { fetchTextImpl: async () => JSON.stringify({ version: "1.2.8" }) }),
]).then((versions) => {
  assert.deepStrictEqual(versions, ["2026.09.01-bbbbbbb", "1.2.8"]);
  return runResolvedCommand(process.execPath, ["--version"]);
}).then((result) => {
  assert.strictEqual(result.ok, true);
  assert.ok(extractVersion(result.stdout));
  return runResolvedCommand(process.execPath, ["bad arg with spaces"]);
}).then((invalid) => {
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.error, "invalid-command-arg");
  console.log("CLI maintenance tests passed");
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
