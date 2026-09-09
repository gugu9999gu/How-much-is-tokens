const { execFile } = require("child_process");
const { resolveCommand, cmdQuotedPath } = require("./credential-login");

const INSPECT_CACHE_MS = 10 * 60 * 1000;
const VERSION_TIMEOUT_MS = 4_000;
const LATEST_TIMEOUT_MS = 8_000;
const UPDATE_TIMEOUT_MS = 120_000;
const CODEX_WINDOWS_INSTALLER = "https://chatgpt.com/codex/install.ps1";

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
  },
  cursor: {
    label: "Cursor",
    commands: ["cursor-agent", "agent"],
    versionArgs: ["--version"],
    updateArgs: ["update"],
    autoUpdate: true,
  },
  grokbot: {
    label: "Grok Bot",
    aliasOf: "cursor",
  },
  copilot: {
    label: "Copilot / GitHub CLI",
    commands: ["gh"],
    versionArgs: ["--version"],
  },
  antigravity: {
    label: "Antigravity",
    commands: ["agy"],
    versionArgs: ["--version"],
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

  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    const quoted = cmdQuotedPath(executable);
    if (!quoted) return { ok: false, stdout: "", stderr: "", error: "invalid-command-path" };
    const suffix = argv.length ? ` ${argv.join(" ")}` : "";
    const comspec = process.env.ComSpec || "cmd.exe";
    return execResult(comspec, ["/d", "/s", "/c", `call ${quoted}${suffix}`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }

  return execResult(executable, argv, options);
}

async function latestNpmVersion(packageName) {
  const npm = resolveCommand(["npm"]);
  if (!npm) return null;
  const result = await runResolvedCommand(npm, ["view", packageName, "version"], { timeout: LATEST_TIMEOUT_MS });
  return result.ok ? extractVersion(`${result.stdout}\n${result.stderr}`) : null;
}

function codexUpdateKind(executable, platform = process.platform) {
  const path = String(executable || "");
  if (/(?:^|[\\/])npm(?:[\\/])/i.test(path) && /\.(?:cmd|bat)$/i.test(path)) return "npm";
  if (platform === "win32") return "windows-installer";
  return "npm";
}

function updateSupportedFor(spec, executable) {
  if (!spec || !executable) return false;
  if (Array.isArray(spec.updateArgs)) return true;
  if (spec.updateMethod === "codex-official") {
    if (codexUpdateKind(executable) === "windows-installer") return !!resolveCommand(["powershell.exe", "powershell"]);
    return !!resolveCommand(["npm"]);
  }
  return false;
}

async function inspectCli(providerId, options = {}) {
  const spec = resolvedSpec(providerId);
  if (!spec) return { providerId: String(providerId || ""), installed: false, reason: "unsupported-provider" };

  const executable = resolveCommand(spec.commands);
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

  const versionResult = await runResolvedCommand(executable, spec.versionArgs || ["--version"], { timeout: VERSION_TIMEOUT_MS });
  const installedVersion = extractVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  let latestVersion = null;
  if (options.checkLatest !== false && spec.npmPackage) {
    latestVersion = await latestNpmVersion(spec.npmPackage);
  }
  const comparison = installedVersion && latestVersion ? compareVersions(installedVersion, latestVersion) : null;

  return {
    providerId: spec.id,
    sourceId: spec.sourceId,
    label: spec.label,
    installed: versionResult.ok || !!installedVersion,
    installedVersion,
    latestVersion,
    updateAvailable: comparison === -1,
    updateSupported: updateSupportedFor(spec, executable),
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

async function runCodexUpdate(executable) {
  const kind = codexUpdateKind(executable);
  if (kind === "npm") {
    const npm = resolveCommand(["npm"]);
    if (!npm) return { ok: false, stdout: "", stderr: "", error: "npm-not-found" };
    return runResolvedCommand(npm, ["install", "-g", "@openai/codex@latest"], { timeout: UPDATE_TIMEOUT_MS });
  }

  const powershell = resolveCommand(["powershell.exe", "powershell"]);
  if (!powershell) return { ok: false, stdout: "", stderr: "", error: "powershell-not-found" };
  // Fixed, vendor-controlled installer URL from OpenAI's Codex README. No
  // renderer/user input reaches this PowerShell command.
  return execResult(powershell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `irm '${CODEX_WINDOWS_INSTALLER}' | iex`,
  ], { timeout: UPDATE_TIMEOUT_MS });
}

async function updateCli(providerId) {
  const spec = resolvedSpec(providerId);
  if (!spec) return { ok: false, providerId: String(providerId || ""), reason: "update-not-supported" };
  const executable = resolveCommand(spec.commands);
  if (!executable) return { ok: false, providerId: spec.id, reason: "cli-not-found" };
  if (!updateSupportedFor(spec, executable)) return { ok: false, providerId: spec.id, reason: "update-not-supported" };

  const result = spec.updateMethod === "codex-official"
    ? await runCodexUpdate(executable)
    : await runResolvedCommand(executable, spec.updateArgs, { timeout: UPDATE_TIMEOUT_MS });
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
  const status = await inspectCli(spec.id, { checkLatest: true });
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
  extractVersion,
  compareVersions,
  resolvedSpec,
  runResolvedCommand,
  codexUpdateKind,
  updateSupportedFor,
  inspectCli,
  inspectAllCli,
  runCodexUpdate,
  updateCli,
  clearCliInspectionCache,
};
