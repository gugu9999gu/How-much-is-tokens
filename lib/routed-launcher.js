const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { profileEnvironment } = require("./account-profiles");
const { ROUTABLE_PROVIDERS } = require("./account-router");

const PROVIDER_COMMANDS = {
  codex: "codex",
  claude: "claude",
  grok: "grok",
};

const PROVIDER_BIN_ENV = {
  codex: "CODEX_BIN",
  claude: "CLAUDE_BIN",
  grok: "GROK_BIN",
};

function parseRouteRequest(argv) {
  const args = Array.isArray(argv) ? argv.map((value) => String(value)) : [];
  const index = args.indexOf("--route");
  if (index < 0 || !args[index + 1]) return null;
  const providerId = String(args[index + 1]).trim().toLowerCase();
  if (!ROUTABLE_PROVIDERS.includes(providerId)) return null;
  return { providerId };
}

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

function resolveProviderExecutable(providerId, options = {}) {
  if (!ROUTABLE_PROVIDERS.includes(providerId)) return null;
  const env = options.env || process.env;
  const explicitName = PROVIDER_BIN_ENV[providerId];
  const explicit = explicitName && env[explicitName] ? String(env[explicitName]).trim() : "";
  if (explicit) return explicit;

  const command = PROVIDER_COMMANDS[providerId];
  const platform = options.platform || process.platform;
  const output = platform === "win32"
    ? commandOutput("where.exe", [command], env, options.execFileSyncImpl)
    : commandOutput("which", [command], env, options.execFileSyncImpl);
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function cmdQuotedPath(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function launchRoutedCli(providerId, profile, options = {}) {
  if (!ROUTABLE_PROVIDERS.includes(providerId)) {
    return { ok: false, reason: "unsupported-provider", providerId };
  }

  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return { ok: false, reason: "unsupported-platform", providerId };
  }

  const env = profile ? profileEnvironment(profile) : { ...process.env };
  const executable = options.executable || resolveProviderExecutable(providerId, {
    env,
    platform,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  if (!executable) return { ok: false, reason: "cli-not-found", providerId };

  const spawnImpl = options.spawnImpl || spawn;
  const comspec = options.comspec || env.ComSpec || process.env.ComSpec || "cmd.exe";
  const cwd = options.cwd || process.cwd();
  const commandLine = `call ${cmdQuotedPath(executable)}`;

  let child;
  try {
    child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
      cwd,
      env,
      detached: true,
      windowsHide: false,
      stdio: "ignore",
    });
    if (child && typeof child.unref === "function") child.unref();
  } catch (err) {
    return {
      ok: false,
      reason: "spawn-failed",
      providerId,
      error: err.message || String(err),
    };
  }

  return {
    ok: true,
    providerId,
    executable,
    profileId: profile ? profile.id : null,
    accountLabel: profile ? profile.label : "기본 계정",
  };
}

function batchLiteral(value) {
  return String(value).replace(/%/g, "%%");
}

function launcherScript(appExecutable, providerId) {
  const exe = batchLiteral(appExecutable);
  return [
    "@echo off",
    "setlocal",
    `"${exe}" --route ${providerId}`,
    "endlocal",
    "",
  ].join("\r\n");
}

function installRouterLaunchers(options = {}) {
  const appExecutable = String(options.appExecutable || "").trim();
  const binDir = String(options.binDir || "").trim();
  if (!appExecutable || !binDir) return { ok: false, reason: "missing-path" };

  try {
    fs.mkdirSync(binDir, { recursive: true });
    const files = [];
    for (const providerId of ROUTABLE_PROVIDERS) {
      const filename = `${providerId}-auto.cmd`;
      const filePath = path.join(binDir, filename);
      fs.writeFileSync(filePath, launcherScript(appExecutable, providerId), "utf8");
      files.push(filePath);
    }
    const readme = path.join(binDir, "README.txt");
    fs.writeFileSync(readme, [
      "How much is tokens Smart Routing launchers",
      "",
      "codex-auto.cmd  - Smart Routing policy로 Codex 계정 선택 후 실행",
      "claude-auto.cmd - Smart Routing policy로 Claude 계정 선택 후 실행",
      "grok-auto.cmd   - Smart Routing policy로 Grok 계정 선택 후 실행",
      "",
      "이 폴더를 PATH에 추가하면 어느 터미널에서나 위 명령을 사용할 수 있습니다.",
      "라우팅은 새 CLI 프로세스에만 적용되며 이미 실행 중인 세션의 계정은 변경하지 않습니다.",
      "",
    ].join("\r\n"), "utf8");
    files.push(readme);
    return { ok: true, binDir, files };
  } catch (err) {
    return { ok: false, reason: "write-failed", error: err.message || String(err) };
  }
}

module.exports = {
  PROVIDER_COMMANDS,
  PROVIDER_BIN_ENV,
  parseRouteRequest,
  commandOutput,
  resolveProviderExecutable,
  cmdQuotedPath,
  launchRoutedCli,
  batchLiteral,
  launcherScript,
  installRouterLaunchers,
};
