const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { appData } = require("./paths");
const { normalizeAccountProfiles, profileEnvironment } = require("./account-profiles");

const PROFILE_LOGIN_PROVIDERS = new Set(["codex", "claude", "grok"]);

const LOGIN_SPECS = Object.freeze({
  codex: {
    label: "Codex",
    commands: ["codex"],
    args: ["login"],
    loginKind: "ChatGPT 브라우저 로그인",
  },
  claude: {
    label: "Claude",
    commands: ["claude"],
    args: ["auth", "login"],
    loginKind: "Claude 브라우저 로그인",
  },
  grok: {
    label: "Grok",
    commands: ["grok"],
    args: ["login"],
    loginKind: "xAI 브라우저 로그인",
  },
  cursor: {
    label: "Cursor",
    // `cursor-agent` is preferred because another CLI may also own `agent`.
    commands: ["cursor-agent", "agent"],
    args: ["login"],
    loginKind: "Cursor 브라우저 로그인",
  },
  copilot: {
    label: "Copilot",
    // The monitor already consumes GitHub CLI OAuth credentials as a safe
    // fallback. Using gh auth avoids asking users to paste a PAT.
    commands: ["gh"],
    args: ["auth", "login"],
    loginKind: "GitHub OAuth 로그인",
  },
  antigravity: {
    label: "Antigravity",
    commands: ["agy"],
    args: [],
    loginKind: "Google 로그인",
  },
});

function commandOutput(command, args, env, execImpl = execFileSync) {
  try {
    return String(execImpl(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }) || "");
  } catch {
    return "";
  }
}

function resolveCommand(commands, options = {}) {
  const candidates = Array.isArray(commands) ? commands : [commands];
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  for (const command of candidates) {
    if (!command) continue;
    const output = platform === "win32"
      ? commandOutput("where.exe", [command], env, options.execFileSyncImpl)
      : commandOutput("which", [command], env, options.execFileSyncImpl);
    const resolved = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (resolved) return resolved;
  }
  return null;
}

function cmdQuotedPath(value) {
  const text = String(value || "");
  if (!text || /[\r\n"]/.test(text)) return null;
  return `"${text}"`;
}

function safeCommandArg(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9._:/=-]+$/.test(text) ? text : null;
}

function interactiveLoginCommand(executable, args, comspec) {
  const exe = cmdQuotedPath(executable);
  const shell = cmdQuotedPath(comspec);
  if (!exe || !shell) return null;
  const safeArgs = (Array.isArray(args) ? args : []).map(safeCommandArg);
  if (safeArgs.some((arg) => !arg)) return null;
  const suffix = safeArgs.length ? ` ${safeArgs.join(" ")}` : "";
  return `start "" ${shell} /d /k call ${exe}${suffix}`;
}

function providerSpec(providerId) {
  return LOGIN_SPECS[String(providerId || "").toLowerCase()] || null;
}

function launchCredentialLogin(providerId, profile = null, options = {}) {
  const id = String(providerId || "").toLowerCase();
  const spec = providerSpec(id);
  if (!spec) return { ok: false, providerId: id, reason: "unsupported-provider" };

  const platform = options.platform || process.platform;
  if (platform !== "win32") return { ok: false, providerId: id, reason: "unsupported-platform" };

  if (profile && !PROFILE_LOGIN_PROVIDERS.has(id)) {
    return { ok: false, providerId: id, reason: "profiles-not-supported" };
  }

  const env = profile ? profileEnvironment(profile) : { ...process.env };
  const executable = options.executable || resolveCommand(spec.commands, {
    platform,
    env,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  if (!executable) {
    return {
      ok: false,
      providerId: id,
      reason: "cli-not-found",
      commands: [...spec.commands],
    };
  }

  const comspec = options.comspec || env.ComSpec || process.env.ComSpec || "cmd.exe";
  const commandLine = interactiveLoginCommand(executable, spec.args, comspec);
  if (!commandLine) return { ok: false, providerId: id, reason: "invalid-command" };

  const spawnImpl = options.spawnImpl || spawn;
  try {
    const child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
      env,
      cwd: options.cwd || process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    if (child && typeof child.unref === "function") child.unref();
  } catch (err) {
    return {
      ok: false,
      providerId: id,
      reason: "spawn-failed",
      error: err.message || String(err),
    };
  }

  return {
    ok: true,
    providerId: id,
    label: spec.label,
    loginKind: spec.loginKind,
    executable,
    profileId: profile ? profile.id : null,
    accountLabel: profile ? profile.label : "기본 계정",
    needsRefresh: true,
  };
}

function managedProfilesRoot() {
  return path.join(appData(), "how-much-is-tokens", "profiles");
}

function nextManagedProfile(settings = {}, providerId, options = {}) {
  const id = String(providerId || "").toLowerCase();
  if (!PROFILE_LOGIN_PROVIDERS.has(id)) return null;
  const existing = normalizeAccountProfiles(settings.accountProfiles)
    .filter((profile) => profile.providerId === id);
  const root = options.rootDir || managedProfilesRoot();
  const labelBase = providerSpec(id)?.label || id;
  const usedDirs = new Set(existing.map((profile) => path.resolve(profile.configDir).toLowerCase()));
  let ordinal = 2; // default login is account #1
  let configDir = path.join(root, id, `account-${ordinal}`);
  while (usedDirs.has(path.resolve(configDir).toLowerCase()) || fs.existsSync(configDir)) {
    ordinal += 1;
    configDir = path.join(root, id, `account-${ordinal}`);
  }
  return {
    providerId: id,
    label: `${labelBase} ${ordinal}`,
    configDir,
    enabled: true,
  };
}

function ensureProfileDirectory(profile) {
  if (!profile || !profile.configDir) return false;
  fs.mkdirSync(profile.configDir, { recursive: true });
  return true;
}

function findProfile(settings = {}, providerId, profileId) {
  const id = String(providerId || "").toLowerCase();
  return normalizeAccountProfiles(settings.accountProfiles)
    .find((profile) => profile.providerId === id && profile.id === profileId) || null;
}

module.exports = {
  PROFILE_LOGIN_PROVIDERS,
  LOGIN_SPECS,
  commandOutput,
  resolveCommand,
  cmdQuotedPath,
  safeCommandArg,
  interactiveLoginCommand,
  providerSpec,
  launchCredentialLogin,
  managedProfilesRoot,
  nextManagedProfile,
  ensureProfileDirectory,
  findProfile,
};