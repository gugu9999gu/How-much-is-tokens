const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const { resolveCommand, cmdQuotedPath } = require("./credential-login");

const INSPECT_CACHE_MS = 10 * 60 * 1000;
const VERSION_TIMEOUT_MS = 4_000;
const LATEST_TIMEOUT_MS = 8_000;
const UPDATE_TIMEOUT_MS = 180_000;
const CODEX_WINDOWS_INSTALLER = "https://chatgpt.com/codex/install.ps1";
const GROK_WINDOWS_INSTALLER = "https://x.ai/cli/install.ps1";
const CURSOR_WINDOWS_INSTALLER = "https://cursor.com/install?win32=true";
const ANTIGRAVITY_WINDOWS_INSTALLER = "https://antigravity.google/cli/install.ps1";
const GROK_STABLE_VERSION = "https://x.ai/cli/stable";
const ANTIGRAVITY_WINDOWS_MANIFEST = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_amd64.json";
const GITHUB_CLI_LATEST_RELEASE = "https://api.github.com/repos/cli/cli/releases/latest";

const CLI_SPECS = Object.freeze({
  codex: {
    label: "Codex",
    commands: ["codex"],
    versionArgs: ["--version"],
    npmPackage: "@openai/codex",
    updateMethod: "codex-official",
  },
  claude: {
    label: "Claude",
    commands: ["claude"],
    versionArgs: ["--version"],
    npmPackage: "@anthropic-ai/claude-code",
    updateArgs: ["update"],
  },
  grok: {
    label: "Grok",
    commands: ["grok"],
    versionArgs: ["--version"],
    latestCommand: ["update", "--check"],
    latestParser: "grok-update-check",
    updateArgs: ["update"],
  },
  cursor: {
    label: "Cursor",
    commands: ["cursor-agent", "agent"],
    versionArgs: ["--version"],
    latestSource: { type: "cursor-installer", url: CURSOR_WINDOWS_INSTALLER },
    updateArgs: ["update"],
    autoUpdate: true,
  },
  grokbot: {
    label: "Grok Bot",
    aliasOf: "cursor",
  },
  copilot: {
    label: "Copilot",
    commands: ["copilot"],
    versionArgs: ["--version"],
    npmPackage: "@github/copilot",
    updateMethod: "copilot-official",
    autoUpdate: true,
  },
  antigravity: {
    label: "Antigravity",
    commands: ["agy"],
    versionArgs: ["--version"],
    latestSource: { type: "json-version", url: ANTIGRAVITY_WINDOWS_MANIFEST },
    updateMethod: "powershell-installer",
    installerUrl: ANTIGRAVITY_WINDOWS_INSTALLER,
    autoUpdate: true,
  },
});

let inspectCache = null;
let inspectCacheAt = 0;

function safeCommandArg(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9@._:/=+~-]+$/.test(text) ? text : null;
}

function resolvedSpec(providerId) {
  const id = String(providerId || "").toLowerCase();
  const source = CLI_SPECS[id];
  if (!source) return null;
  if (!source.aliasOf) return { id, sourceId: id, ...source };
  const base = CLI_SPECS[source.aliasOf];
  return base ? { id, sourceId: source.aliasOf, ...base, label: source.label } : null;
}

function extractVersion(value) {
  const match = String(value || "").match(/\bv?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match ? match[1] : null;
}

function versionFromGrokUpdateCheck(value) {
  const match = String(value || "").match(/latest:\s*v?([0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/i);
  return match ? match[1] : extractVersion(value);
}

function versionParts(value) {
  const version = extractVersion(value);
  if (!version) return null;
  const [core, suffix = ""] = version.split(/[-+]/, 2);
  const parts = core.split(".").map((part) => Number(part));
  while (parts.length < 4) parts.push(0);
  return { version, parts, prerelease: version.includes("-") ? suffix || "pre" : "" };
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < 4; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] < right.parts[index] ? -1 : 1;
  }
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.version === right.version) return 0;
  return left.version.localeCompare(right.version, undefined, { numeric: true, sensitivity: "base" });
}

function execResult(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: options.timeout || VERSION_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: options.env || process.env,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: error ? (error.message || String(error)) : null,
      });
    });
  });
}

async function runResolvedCommand(executable, args, options = {}) {
  const argv = (Array.isArray(args) ? args : []).map(safeCommandArg);
  if (argv.some((arg) => !arg)) return { ok: false, stdout: "", stderr: "", error: "invalid-command-arg" };

  const platform = options.platform || process.platform;
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    const quoted = cmdQuotedPath(executable);
    if (!quoted) return { ok: false, stdout: "", stderr: "", error: "invalid-command-path" };
    const suffix = argv.length ? ` ${argv.join(" ")}` : "";
    const comspec = options.comspec || process.env.ComSpec || "cmd.exe";
    return execResult(comspec, ["/d", "/s", "/c", `call ${quoted}${suffix}`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }

  return execResult(executable, argv, options);
}

function fetchText(url, options = {}, redirectCount = 0) {
  return new Promise((resolve) => {
    if (!url || redirectCount > 4) return resolve(null);
    let parsed;
    try { parsed = new URL(url); } catch { return resolve(null); }
    const transport = parsed.protocol === "http:" ? http : https;
    const request = transport.get(parsed, {
      headers: {
        Accept: "text/plain, application/json, */*",
        "User-Agent": "How-much-is-tokens/cli-maintenance",
      },
      timeout: options.timeout || LATEST_TIMEOUT_MS,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        resolve(fetchText(next, options, redirectCount + 1));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        resolve(null);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 1024 * 1024) body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

async function latestNpmVersion(packageName, options = {}) {
  const npm = resolveCommand(["npm"], options);
  if (!npm) return null;
  const result = await runResolvedCommand(npm, ["view", packageName, "version"], {
    timeout: LATEST_TIMEOUT_MS,
    platform: options.platform,
    comspec: options.comspec,
  });
  return result.ok ? extractVersion(`${result.stdout}\n${result.stderr}`) : null;
}

function versionFromCursorInstaller(text) {
  const match = String(text || "").match(/\$version\s*=\s*['"]([^'"]+)['"]/i);
  return match ? extractVersion(match[1]) : null;
}

function versionFromGithubRelease(text) {
  try {
    const data = JSON.parse(String(text || ""));
    return extractVersion(data.tag_name || data.name || "");
  } catch {
    return null;
  }
}

function versionFromManifest(text) {
  try {
    const data = JSON.parse(String(text || ""));
    const candidates = [data.version, data.url, data.download_url, data.downloadUrl, JSON.stringify(data)];
    for (const value of candidates) {
      const version = extractVersion(value);
      if (version) return version;
    }
  } catch {}
  return extractVersion(text);
}

async function latestVersionFor(spec, options = {}, executable = null) {
  if (!spec) return null;
  if (spec.npmPackage) return latestNpmVersion(spec.npmPackage, options);
  if (Array.isArray(spec.latestCommand) && executable) {
    const result = await runResolvedCommand(executable, spec.latestCommand, {
      timeout: LATEST_TIMEOUT_MS,
      platform: options.platform,
      comspec: options.comspec,
    });
    if (!result.ok) return null;
    const output = `${result.stdout}\n${result.stderr}`;
    return spec.latestParser === "grok-update-check" ? versionFromGrokUpdateCheck(output) : extractVersion(output);
  }
  if (!spec.latestSource || options.checkLatest === false) return null;
  const fetchImpl = options.fetchTextImpl || fetchText;
  const text = await fetchImpl(spec.latestSource.url, { timeout: LATEST_TIMEOUT_MS });
  if (!text) return null;
  if (spec.latestSource.type === "cursor-installer") return versionFromCursorInstaller(text);
  if (spec.latestSource.type === "github-release") return versionFromGithubRelease(text);
  if (spec.latestSource.type === "json-version") return versionFromManifest(text);
  return extractVersion(text);
}

function codexUpdateKind(executable, platform = process.platform) {
  const pathText = String(executable || "");
  if (/(?:^|[\\/])npm(?:[\\/])/i.test(pathText) && /\.(?:cmd|bat)$/i.test(pathText)) return "npm";
  if (platform === "win32") return "windows-installer";
  return "npm";
}

function copilotUpdateKind(executable, platform = process.platform) {
  const value = String(executable || "");
  if (/(?:^|[\\/])npm(?:[\\/])/i.test(value) && /\.(?:cmd|bat)$/i.test(value)) return "npm";
  if (platform === "win32" && /(?:winget|windowsapps)/i.test(value)) return "winget";
  return null;
}

function updateSupportedFor(spec, executable, options = {}) {
  if (!spec || !executable) return false;
  if (Array.isArray(spec.updateArgs)) return true;
  if (spec.updateMethod === "codex-official") {
    if (codexUpdateKind(executable, options.platform || process.platform) === "windows-installer") {
      return !!resolveCommand(["powershell.exe", "powershell"], options);
    }
    return !!resolveCommand(["npm"], options);
  }
  if (spec.updateMethod === "copilot-official") {
    const kind = copilotUpdateKind(executable, options.platform || process.platform);
    if (kind === "npm") return !!resolveCommand(["npm"], options);
    if (kind === "winget") return !!resolveCommand(["winget.exe", "winget"], options);
    return false;
  }
  if (spec.updateMethod === "powershell-installer") return !!resolveCommand(["powershell.exe", "powershell"], options);
  if (spec.updateMethod === "winget") return !!resolveCommand(["winget.exe", "winget"], options);
  return false;
}

async function inspectCli(providerId, options = {}) {
  const spec = resolvedSpec(providerId);
  if (!spec) return { providerId: String(providerId || ""), installed: false, reason: "unsupported-provider" };

  const executable = options.executable || resolveCommand(spec.commands, options);
  if (!executable) {
    return {
      providerId: spec.id,
      sourceId: spec.sourceId,
      label: spec.label,
      installed: false,
      updateSupported: false,
      autoUpdate: spec.autoUpdate === true,
    };
  }

  const versionResult = await runResolvedCommand(executable, spec.versionArgs || ["--version"], {
    timeout: VERSION_TIMEOUT_MS,
    platform: options.platform,
    comspec: options.comspec,
  });
  const installedVersion = extractVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const latestVersion = options.checkLatest === false ? null : await latestVersionFor(spec, options, executable);
  const comparison = installedVersion && latestVersion ? compareVersions(installedVersion, latestVersion) : null;

  return {
    providerId: spec.id,
    sourceId: spec.sourceId,
    label: spec.label,
    installed: versionResult.ok || !!installedVersion,
    installedVersion,
    latestVersion,
    updateAvailable: comparison === -1,
    updateSupported: updateSupportedFor(spec, executable, options),
    autoUpdate: spec.autoUpdate === true,
    executable,
    error: versionResult.ok ? null : versionResult.error,
  };
}

async function inspectAllCli(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && inspectCache && now - inspectCacheAt < INSPECT_CACHE_MS) {
    return inspectCache.map((item) => ({ ...item }));
  }

  const sourceIds = Object.keys(CLI_SPECS).filter((id) => !CLI_SPECS[id].aliasOf);
  const sources = await Promise.all(sourceIds.map((id) => inspectCli(id, options)));
  const byId = new Map(sources.map((item) => [item.providerId, item]));
  const all = Object.keys(CLI_SPECS).map((id) => {
    const spec = resolvedSpec(id);
    if (!spec || !CLI_SPECS[id].aliasOf) return { ...(byId.get(id) || { providerId: id, installed: false }) };
    const source = byId.get(spec.sourceId) || {};
    return { ...source, providerId: id, sourceId: spec.sourceId, label: CLI_SPECS[id].label };
  });
  inspectCache = all;
  inspectCacheAt = now;
  return all.map((item) => ({ ...item }));
}

async function runPowerShellInstaller(url, options = {}) {
  const powershell = resolveCommand(["powershell.exe", "powershell"], options);
  if (!powershell) return { ok: false, stdout: "", stderr: "", error: "powershell-not-found" };
  return execResult(powershell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `irm '${url}' | iex`,
  ], { timeout: UPDATE_TIMEOUT_MS });
}

async function runCodexUpdate(executable, options = {}) {
  const kind = codexUpdateKind(executable, options.platform || process.platform);
  if (kind === "npm") {
    const npm = resolveCommand(["npm"], options);
    if (!npm) return { ok: false, stdout: "", stderr: "", error: "npm-not-found" };
    return runResolvedCommand(npm, ["install", "-g", "@openai/codex@latest"], { timeout: UPDATE_TIMEOUT_MS, platform: options.platform });
  }
  return runPowerShellInstaller(CODEX_WINDOWS_INSTALLER, options);
}

async function runCopilotUpdate(executable, options = {}) {
  const kind = copilotUpdateKind(executable, options.platform || process.platform);
  if (kind === "npm") {
    const npm = resolveCommand(["npm"], options);
    if (!npm) return { ok: false, stdout: "", stderr: "", error: "npm-not-found" };
    return runResolvedCommand(npm, ["install", "-g", "@github/copilot@latest"], { timeout: UPDATE_TIMEOUT_MS, platform: options.platform });
  }
  if (kind === "winget") return runWingetUpdate("GitHub.Copilot", options);
  return { ok: false, stdout: "", stderr: "", error: "unsupported-install-method" };
}

async function runWingetUpdate(packageId, options = {}) {
  const winget = resolveCommand(["winget.exe", "winget"], options);
  if (!winget) return { ok: false, stdout: "", stderr: "", error: "winget-not-found" };
  return runResolvedCommand(winget, [
    "upgrade", "--id", packageId, "--exact", "--accept-source-agreements", "--accept-package-agreements",
  ], { timeout: UPDATE_TIMEOUT_MS, platform: options.platform });
}

async function updateCli(providerId, options = {}) {
  const spec = resolvedSpec(providerId);
  if (!spec) return { ok: false, providerId: String(providerId || ""), reason: "update-not-supported" };
  const executable = options.executable || resolveCommand(spec.commands, options);
  if (!executable) return { ok: false, providerId: spec.id, reason: "cli-not-found" };
  if (!updateSupportedFor(spec, executable, options)) return { ok: false, providerId: spec.id, reason: "update-not-supported" };

  let result;
  if (spec.updateMethod === "codex-official") result = await runCodexUpdate(executable, options);
  else if (spec.updateMethod === "copilot-official") result = await runCopilotUpdate(executable, options);
  else if (spec.updateMethod === "powershell-installer") result = await runPowerShellInstaller(spec.installerUrl, options);
  else if (spec.updateMethod === "winget") result = await runWingetUpdate(spec.wingetId, options);
  else result = await runResolvedCommand(executable, spec.updateArgs, { timeout: UPDATE_TIMEOUT_MS, platform: options.platform });

  if (!result.ok) {
    return {
      ok: false,
      providerId: spec.id,
      reason: "update-failed",
      error: result.stderr.trim() || result.stdout.trim() || result.error || "CLI update failed",
    };
  }

  inspectCache = null;
  inspectCacheAt = 0;
  const status = await inspectCli(spec.id, { ...options, checkLatest: true });
  return {
    ok: true,
    providerId: spec.id,
    output: result.stdout.trim() || result.stderr.trim(),
    status,
  };
}

function clearCliInspectionCache() {
  inspectCache = null;
  inspectCacheAt = 0;
}

module.exports = {
  CLI_SPECS,
  CODEX_WINDOWS_INSTALLER,
  GROK_WINDOWS_INSTALLER,
  CURSOR_WINDOWS_INSTALLER,
  ANTIGRAVITY_WINDOWS_INSTALLER,
  GROK_STABLE_VERSION,
  ANTIGRAVITY_WINDOWS_MANIFEST,
  GITHUB_CLI_LATEST_RELEASE,
  extractVersion,
  versionFromGrokUpdateCheck,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
  fetchText,
  latestNpmVersion,
  versionFromCursorInstaller,
  versionFromGithubRelease,
  versionFromManifest,
  latestVersionFor,
  codexUpdateKind,
  copilotUpdateKind,
  updateSupportedFor,
  inspectCli,
  inspectAllCli,
  runPowerShellInstaller,
  runCodexUpdate,
  runCopilotUpdate,
  runWingetUpdate,
  updateCli,
  clearCliInspectionCache,
};
