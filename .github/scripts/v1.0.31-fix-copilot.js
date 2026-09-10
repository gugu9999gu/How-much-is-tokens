const fs = require("fs");

function replaceExact(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing ${label}`);
  return text.replace(before, after);
}

const routePath = "lib/routed-launcher.js";
let route = fs.readFileSync(routePath, "utf8");
route = replaceExact(route,
  'const { resolvedAgm } = require("./antigravity-account-manager");',
  'const { resolvedAgm } = require("./antigravity-account-manager");\nconst { resolveCommand } = require("./credential-login");',
  "route resolveCommand import");
route = replaceExact(route, '  copilot: ["gh"],', '  copilot: ["copilot"],', "copilot executable");
route = replaceExact(route,
  'const PROVIDER_ARGS = {\n  copilot: ["copilot"],\n};',
  'const PROVIDER_ARGS = {};',
  "legacy gh copilot args");
route = replaceExact(route, '  copilot: "GH_BIN",', '  copilot: "COPILOT_BIN",', "copilot binary override");
route = replaceExact(route,
  "function applyDefaultEnvironment(providerId, env) {",
  `function injectCopilotProfileToken(profile, env, options = {}) {
  if (!profile) return { ok: true, env };
  const platform = options.platform || process.platform;
  const gh = options.ghExecutable || resolveCommand(["gh"], {
    platform,
    env,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  if (!gh) return { ok: false, reason: "github-cli-not-found" };
  try {
    const token = String((options.execFileSyncImpl || execFileSync)(gh, ["auth", "token"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }) || "").trim();
    if (!token) return { ok: false, reason: "copilot-profile-token-missing" };
    return { ok: true, env: { ...env, COPILOT_GITHUB_TOKEN: token } };
  } catch (err) {
    return { ok: false, reason: "copilot-profile-token-missing", error: err.message || String(err) };
  }
}

function applyDefaultEnvironment(providerId, env) {`,
  "copilot runtime token helper");
route = replaceExact(route,
  "  const env = profile ? profileEnvironment(profile) : applyDefaultEnvironment(providerId, { ...process.env });",
  "  let env = profile ? profileEnvironment(profile) : applyDefaultEnvironment(providerId, { ...process.env });",
  "mutable launch env");
route = replaceExact(route,
  `  if (providerId === "antigravity") {
    const switched = switchAntigravityProfile(profile, { ...options, env });
    if (!switched.ok) return { ...switched, providerId };
  }

  const executable`,
  `  if (providerId === "antigravity") {
    const switched = switchAntigravityProfile(profile, { ...options, env });
    if (!switched.ok) return { ...switched, providerId };
  }
  if (providerId === "copilot" && profile) {
    const injected = injectCopilotProfileToken(profile, env, options);
    if (!injected.ok) return { ...injected, providerId };
    env = injected.env;
  }

  const executable`,
  "copilot launch token injection");
route = replaceExact(route,
  "  'copilot' { if ($Selected.ConfigDir) { $env:GH_CONFIG_DIR = $Selected.ConfigDir } }",
  `  'copilot' {
    if ($Selected.ConfigDir) { $env:GH_CONFIG_DIR = $Selected.ConfigDir }
    if ($Selected.Order -gt 0) {
      if ($Selected.ConfigDir) { $env:COPILOT_HOME = Join-Path $Selected.ConfigDir 'copilot-home' }
      $Gh = Get-Command gh -ErrorAction SilentlyContinue
      if (!$Gh) { throw 'Copilot 추가 계정 실행에 GitHub CLI(gh)가 필요합니다.' }
      $Token = (& $Gh.Source auth token 2>$null | Select-Object -First 1).Trim()
      if (!$Token) { throw '선택한 Copilot 계정의 GitHub OAuth 토큰을 가져오지 못했습니다.' }
      $env:COPILOT_GITHUB_TOKEN = $Token
    }
  }`,
  "standalone copilot profile injection");
route = replaceExact(route,
  "  'copilot' { & $(if ($env:GH_BIN) { $env:GH_BIN } else { 'gh' }) copilot }",
  "  'copilot' { & $(if ($env:COPILOT_BIN) { $env:COPILOT_BIN } else { 'copilot' }) }",
  "standalone copilot launch");
route = replaceExact(route,
  "  switchAntigravityProfile,\n  applyDefaultEnvironment,",
  "  switchAntigravityProfile,\n  injectCopilotProfileToken,\n  applyDefaultEnvironment,",
  "copilot helper export");
fs.writeFileSync(routePath, route);

const cliPath = "lib/cli-maintenance.js";
let cli = fs.readFileSync(cliPath, "utf8");
cli = replaceExact(cli,
  `  grok: {
    label: "Grok",
    commands: ["grok"],
    versionArgs: ["--version"],
    latestSource: { type: "text", url: GROK_STABLE_VERSION },
    updateMethod: "powershell-installer",
    installerUrl: GROK_WINDOWS_INSTALLER,
  },`,
  `  grok: {
    label: "Grok",
    commands: ["grok"],
    versionArgs: ["--version"],
    latestCommand: ["update", "--check"],
    updateArgs: ["update"],
  },`,
  "grok official updater");
cli = replaceExact(cli,
  `  copilot: {
    label: "Copilot / GitHub CLI",
    commands: ["gh"],
    versionArgs: ["--version"],
    latestSource: { type: "github-release", url: GITHUB_CLI_LATEST_RELEASE },
    updateMethod: "winget",
    wingetId: "GitHub.cli",
  },`,
  `  copilot: {
    label: "Copilot",
    commands: ["copilot"],
    versionArgs: ["--version"],
    npmPackage: "@github/copilot",
    updateMethod: "copilot-official",
    autoUpdate: true,
  },`,
  "standalone copilot maintenance");
cli = replaceExact(cli,
  "async function latestVersionFor(spec, options = {}) {\n  if (!spec) return null;\n  if (spec.npmPackage) return latestNpmVersion(spec.npmPackage, options);",
  `async function latestVersionFor(spec, options = {}, executable = null) {
  if (!spec) return null;
  if (spec.npmPackage) return latestNpmVersion(spec.npmPackage, options);
  if (Array.isArray(spec.latestCommand) && executable) {
    const result = await runResolvedCommand(executable, spec.latestCommand, {
      timeout: LATEST_TIMEOUT_MS,
      platform: options.platform,
      comspec: options.comspec,
    });
    return result.ok ? extractVersion(\`${"${result.stdout}"}\\n${"${result.stderr}"}\`) : null;
  }`,
  "latest command support");
cli = replaceExact(cli,
  "  const latestVersion = options.checkLatest === false ? null : await latestVersionFor(spec, options);",
  "  const latestVersion = options.checkLatest === false ? null : await latestVersionFor(spec, options, executable);",
  "latest command executable");
cli = replaceExact(cli,
  "function updateSupportedFor(spec, executable, options = {}) {",
  `function copilotUpdateKind(executable, platform = process.platform) {
  const value = String(executable || "");
  if (/(?:^|[\\\\/])npm(?:[\\\\/])/i.test(value) && /\\.(?:cmd|bat)$/i.test(value)) return "npm";
  if (platform === "win32" && /(?:winget|windowsapps)/i.test(value)) return "winget";
  return null;
}

function updateSupportedFor(spec, executable, options = {}) {`,
  "copilot update kind");
cli = replaceExact(cli,
  '  if (spec.updateMethod === "powershell-installer") return !!resolveCommand(["powershell.exe", "powershell"], options);',
  `  if (spec.updateMethod === "copilot-official") {
    const kind = copilotUpdateKind(executable, options.platform || process.platform);
    if (kind === "npm") return !!resolveCommand(["npm"], options);
    if (kind === "winget") return !!resolveCommand(["winget.exe", "winget"], options);
    return false;
  }
  if (spec.updateMethod === "powershell-installer") return !!resolveCommand(["powershell.exe", "powershell"], options);`,
  "copilot update support");
cli = replaceExact(cli,
  "async function runWingetUpdate(packageId, options = {}) {",
  `async function runCopilotUpdate(executable, options = {}) {
  const kind = copilotUpdateKind(executable, options.platform || process.platform);
  if (kind === "npm") {
    const npm = resolveCommand(["npm"], options);
    if (!npm) return { ok: false, stdout: "", stderr: "", error: "npm-not-found" };
    return runResolvedCommand(npm, ["install", "-g", "@github/copilot@latest"], { timeout: UPDATE_TIMEOUT_MS, platform: options.platform });
  }
  if (kind === "winget") return runWingetUpdate("GitHub.Copilot", options);
  return { ok: false, stdout: "", stderr: "", error: "unsupported-install-method" };
}

async function runWingetUpdate(packageId, options = {}) {`,
  "copilot update runner");
cli = replaceExact(cli,
  '  if (spec.updateMethod === "codex-official") result = await runCodexUpdate(executable, options);\n  else if (spec.updateMethod === "powershell-installer")',
  '  if (spec.updateMethod === "codex-official") result = await runCodexUpdate(executable, options);\n  else if (spec.updateMethod === "copilot-official") result = await runCopilotUpdate(executable, options);\n  else if (spec.updateMethod === "powershell-installer")',
  "copilot update branch");
cli = replaceExact(cli,
  "  codexUpdateKind,\n  updateSupportedFor,",
  "  codexUpdateKind,\n  copilotUpdateKind,\n  updateSupportedFor,",
  "copilot kind export");
cli = replaceExact(cli,
  "  runCodexUpdate,\n  runWingetUpdate,",
  "  runCodexUpdate,\n  runCopilotUpdate,\n  runWingetUpdate,",
  "copilot runner export");
fs.writeFileSync(cliPath, cli);
