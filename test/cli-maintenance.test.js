const assert = require("assert");
const {
  CLI_SPECS,
  CODEX_WINDOWS_INSTALLER,
  GROK_WINDOWS_INSTALLER,
  CURSOR_WINDOWS_INSTALLER,
  ANTIGRAVITY_WINDOWS_INSTALLER,
  GROK_STABLE_VERSION,
  ANTIGRAVITY_WINDOWS_MANIFEST,
  GITHUB_CLI_LATEST_RELEASE,
  extractVersion,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
  codexUpdateKind,
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
assert.strictEqual(GROK_STABLE_VERSION, "https://x.ai/cli/stable");
assert.ok(ANTIGRAVITY_WINDOWS_MANIFEST.includes("manifests/windows_amd64.json"));
assert.strictEqual(GITHUB_CLI_LATEST_RELEASE, "https://api.github.com/repos/cli/cli/releases/latest");
assert.strictEqual(CLI_SPECS.grok.updateMethod, "powershell-installer");
assert.strictEqual(CLI_SPECS.copilot.updateMethod, "winget");
assert.strictEqual(CLI_SPECS.copilot.wingetId, "GitHub.cli");
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

Promise.all([
  latestVersionFor(CLI_SPECS.grok, { fetchTextImpl: async (url) => {
    assert.strictEqual(url, GROK_STABLE_VERSION); return "1.3.7\n";
  } }),
  latestVersionFor(CLI_SPECS.cursor, { fetchTextImpl: async () => "$version = '2026.09.01-bbbbbbb'" }),
  latestVersionFor(CLI_SPECS.copilot, { fetchTextImpl: async () => JSON.stringify({ tag_name: "v2.90.0" }) }),
  latestVersionFor(CLI_SPECS.antigravity, { fetchTextImpl: async () => JSON.stringify({ version: "1.2.8" }) }),
]).then((versions) => {
  assert.deepStrictEqual(versions, ["1.3.7", "2026.09.01-bbbbbbb", "2.90.0", "1.2.8"]);
  assert.strictEqual(codexUpdateKind("C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd", "win32"), "npm");
  assert.strictEqual(codexUpdateKind("C:\\Users\\test\\.local\\bin\\codex.exe", "win32"), "windows-installer");
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
