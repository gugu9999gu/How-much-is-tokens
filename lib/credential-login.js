const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { appData } = require("./paths");
const { normalizeAccountProfiles, profileEnvironment } = require("./account-profiles");

const POSIX_COMMAND_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

const PROFILE_LOGIN_PROVIDERS = new Set(["codex", "claude", "grok", "cursor", "copilot"]);

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
    commands: ["cursor-agent", "agent"],
    args: ["login"],
    loginKind: "Cursor 브라우저 로그인",
  },
  copilot: {
    label: "Copilot",
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

function preferredWindowsCommand(lines) {
  const candidates = Array.isArray(lines) ? lines.filter(Boolean) : [];
  return candidates.find((value) => /\.(?:exe|com)$/i.test(value))
    || candidates.find((value) => /\.(?:cmd|bat)$/i.test(value))
    || candidates[0]
    || null;
}

function posixCommandEnv(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const source = env && typeof env === "object" ? env : {};
  if (platform === "win32") return source;
  const homeDir = options.homeDir || source.HOME || os.homedir();
  const extras = [
    ...POSIX_COMMAND_DIRS,
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".npm-global", "bin"),
    path.join(homeDir, "Library", "pnpm"),
    path.join(homeDir, ".volta", "bin"),
  ];
  const current = String(source.PATH || "/usr/bin:/bin:/usr/sbin:/sbin");
  const seen = new Set();
  const merged = [];
  for (const part of [...extras, ...current.split(":")]) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    merged.push(part);
  }
  return { ...source, PATH: merged.join(":") };
}

function resolveCommand(commands, options = {}) {
  const candidates = Array.isArray(commands) ? commands : [commands];
  const platform = options.platform || process.platform;
  const env = posixCommandEnv(options.env || process.env, { ...options, platform });
  for (const command of candidates) {
    if (!command) continue;
    const output = platform === "win32"
      ? commandOutput("where.exe", [command], env, options.execFileSyncImpl)
      : commandOutput("which", [command], env, options.execFileSyncImpl);
    const resolved = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (platform === "win32") {
      const preferred = preferredWindowsCommand(resolved);
      if (preferred) return preferred;
    } else if (resolved.length) {
      return resolved[0];
    }
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

const POSIX_LOGIN_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "SHELL",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "GROK_HOME",
  "CURSOR_CONFIG_DIR",
  "GH_CONFIG_DIR",
  "COPILOT_HOME",
];

function posixShellQuote(value) {
  const text = String(value);
  if (text === "") return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function posixLoginScriptLines(executable, args, env = {}, options = {}) {
  const lines = ["#!/bin/zsh", "set +e"];
  for (const key of POSIX_LOGIN_ENV_KEYS) {
    if (env[key] == null || env[key] === "") continue;
    lines.push(`export ${key}=${posixShellQuote(String(env[key]))}`);
  }
  const argv = [executable, ...(Array.isArray(args) ? args : [])].map((item) => posixShellQuote(item));
  lines.push(argv.join(" "));
  lines.push("echo");
  lines.push('echo "로그인 완료 후 이 창을 닫아도 됩니다."');
  if (options.keepShell !== false) lines.push('exec "${SHELL:-/bin/zsh}"');
  return lines;
}

function writePosixLoginScript(executable, args, env, options = {}) {
  const dir = options.scriptDir || os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  const file = options.scriptPath || path.join(dir, `how-much-is-tokens-login-${process.pid}-${Date.now()}.command`);
  fs.writeFileSync(file, `${posixLoginScriptLines(executable, args, env, options).join("\n")}\n`, "utf8");
  fs.chmodSync(file, 0o700);
  return file;
}

function launchInteractiveCli(executable, args, env, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const cwd = options.cwd || (platform === "win32" ? process.cwd() : os.homedir());

  if (platform === "win32") {
    const comspec = options.comspec || (env && env.ComSpec) || process.env.ComSpec || "cmd.exe";
    const commandLine = interactiveLoginCommand(executable, args, comspec);
    if (!commandLine) return { ok: false, reason: "invalid-command" };
    try {
      const child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
        env,
        cwd,
        detached: true,
        windowsVerbatimArguments: true,
        windowsHide: false,
        stdio: "ignore",
      });
      if (child && typeof child.unref === "function") child.unref();
    } catch (err) {
      return { ok: false, reason: "spawn-failed", error: err.message || String(err) };
    }
    return { ok: true };
  }

  if (platform === "darwin") {
    const safeArgs = (Array.isArray(args) ? args : []).map(safeCommandArg);
    if (safeArgs.some((arg) => !arg)) return { ok: false, reason: "invalid-command" };
    let scriptPath;
    try {
      scriptPath = writePosixLoginScript(executable, safeArgs, env, options);
      const child = spawnImpl("open", ["-a", "Terminal", scriptPath], {
        env,
        cwd,
        detached: true,
        stdio: "ignore",
      });
      if (child && typeof child.unref === "function") child.unref();
    } catch (err) {
      return { ok: false, reason: "spawn-failed", error: err.message || String(err) };
    }
    return { ok: true, scriptPath };
  }

  return { ok: false, reason: "unsupported-platform" };
}

function providerSpec(providerId) {
  return LOGIN_SPECS[String(providerId || "").toLowerCase()] || null;
}

function launchCredentialLogin(providerId, profile = null, options = {}) {
  const id = String(providerId || "").toLowerCase();
  const spec = providerSpec(id);
  if (!spec) return { ok: false, providerId: id, reason: "unsupported-provider" };

  const platform = options.platform || process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    return { ok: false, providerId: id, reason: "unsupported-platform" };
  }

  if (profile && !PROFILE_LOGIN_PROVIDERS.has(id)) {
    return { ok: false, providerId: id, reason: "profiles-not-supported" };
  }

  const env = posixCommandEnv(profile ? profileEnvironment(profile) : { ...process.env }, { platform });
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

  const launched = launchInteractiveCli(executable, spec.args, env, { ...options, platform });
  if (!launched.ok) return { ...launched, providerId: id };

  return {
    ok: true,
    providerId: id,
    label: spec.label,
    loginKind: spec.loginKind,
    executable,
    profileId: profile ? profile.id : null,
    accountLabel: profile ? profile.label : "기본 계정",
    needsRefresh: true,
    scriptPath: launched.scriptPath || null,
  };
}

function managedProfilesRoot() {
  return path.join(appData(), "how-much-is-tokens", "profiles");
}

function profileHasLogin(profile) {
  if (!profile || !profile.configDir) return false;
  if (profile.accountId) return true;
  try {
    const { codexIdentity, claudeIdentity, grokIdentity, cursorIdentity } = require("./account-display-identity");
    const id = String(profile.providerId || "").toLowerCase();
    let identity = null;
    if (id === "codex") identity = codexIdentity(profile);
    else if (id === "claude") identity = claudeIdentity(profile);
    else if (id === "grok") identity = grokIdentity(profile);
    else if (id === "cursor") identity = cursorIdentity({}, profile);
    else if (id === "copilot") {
      return ["hosts.yml", "config.yml"].some((name) => fs.existsSync(path.join(profile.configDir, name)));
    }
    return !!(identity && (identity.accountId || identity.accountEmail || identity.accountLogin));
  } catch {
    return false;
  }
}

function vacantManagedProfile(settings = {}, providerId) {
  const id = String(providerId || "").toLowerCase();
  if (!PROFILE_LOGIN_PROVIDERS.has(id)) return null;
  const vacant = normalizeAccountProfiles(settings.accountProfiles)
    .filter((profile) => profile.providerId === id && profile.enabled !== false && !profileHasLogin(profile));
  vacant.sort((a, b) => a.configDir.localeCompare(b.configDir));
  return vacant[0] || null;
}

function nextManagedProfile(settings = {}, providerId, options = {}) {
  const id = String(providerId || "").toLowerCase();
  if (!PROFILE_LOGIN_PROVIDERS.has(id)) return null;
  const existing = normalizeAccountProfiles(settings.accountProfiles)
    .filter((profile) => profile.providerId === id);
  const root = options.rootDir || managedProfilesRoot();
  const labelBase = providerSpec(id)?.label || id;
  const usedDirs = new Set(existing.map((profile) => path.resolve(profile.configDir).toLowerCase()));
  let ordinal = 2;
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
  POSIX_COMMAND_DIRS,
  commandOutput,
  preferredWindowsCommand,
  posixCommandEnv,
  resolveCommand,
  cmdQuotedPath,
  safeCommandArg,
  interactiveLoginCommand,
  POSIX_LOGIN_ENV_KEYS,
  posixShellQuote,
  posixLoginScriptLines,
  writePosixLoginScript,
  launchInteractiveCli,
  providerSpec,
  launchCredentialLogin,
  managedProfilesRoot,
  nextManagedProfile,
  profileHasLogin,
  vacantManagedProfile,
  ensureProfileDirectory,
  findProfile,
};
