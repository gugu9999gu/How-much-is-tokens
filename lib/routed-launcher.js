const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { profileEnvironment, defaultConfigDir } = require("./account-profiles");
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
  const text = String(value || "");
  if (!text || /[\r\n"]/.test(text)) return null;
  return `"${text}"`;
}

function interactiveStartCommand(executable, comspec) {
  const exe = cmdQuotedPath(executable);
  const shell = cmdQuotedPath(comspec);
  if (!exe || !shell) return null;
  // The first empty quoted string is START's window title. A second cmd.exe
  // receives a real console and keeps it open while the interactive CLI runs.
  return `start "" ${shell} /d /k call ${exe}`;
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
  if (!profile) {
    const defaultDir = defaultConfigDir(providerId);
    if (providerId === "codex" && defaultDir) env.CODEX_HOME = defaultDir;
    if (providerId === "claude" && defaultDir) env.CLAUDE_CONFIG_DIR = defaultDir;
    if (providerId === "grok" && defaultDir) env.GROK_HOME = defaultDir;
  }

  const executable = options.executable || resolveProviderExecutable(providerId, {
    env,
    platform,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  if (!executable) return { ok: false, reason: "cli-not-found", providerId };

  const spawnImpl = options.spawnImpl || spawn;
  const comspec = options.comspec || env.ComSpec || process.env.ComSpec || "cmd.exe";
  const cwd = options.cwd || process.cwd();
  const commandLine = interactiveStartCommand(executable, comspec);
  if (!commandLine) return { ok: false, reason: "invalid-executable-path", providerId };

  let child;
  try {
    child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
      cwd,
      env,
      detached: true,
      windowsHide: true,
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

function psLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function powershellRouterScript(stateDir, defaultDirs = {}) {
  const state = psLiteral(stateDir);
  const codexDefault = psLiteral(defaultDirs.codex || "");
  const claudeDefault = psLiteral(defaultDirs.claude || "");
  const grokDefault = psLiteral(defaultDirs.grok || "");
  return `param(\n  [Parameter(Mandatory = $true)]\n  [ValidateSet('codex','claude','grok')]\n  [string]$Provider\n)\n\n$ErrorActionPreference = 'Stop'\n$StateDir = ${state}\n$SettingsPath = Join-Path $StateDir 'settings.json'\n$CachePath = Join-Path $StateDir 'usage-cache.json'\n$DefaultDirs = @{ codex = ${codexDefault}; claude = ${claudeDefault}; grok = ${grokDefault} }\n\nif (!(Test-Path -LiteralPath $SettingsPath)) { throw 'How much is tokens settings.json을 찾을 수 없습니다.' }\n$Settings = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json\n$Routing = $Settings.smartRouting.$Provider\nif (!$Routing -or $Routing.enabled -ne $true) { throw \"$Provider Smart Routing이 꺼져 있습니다. 위젯 설정에서 먼저 활성화하세요.\" }\n\n$Policy = [string]$Routing.policy\n$Threshold = 0.0\nif ($null -ne $Routing.thresholdPct) { $Threshold = [double]$Routing.thresholdPct }\n$RefreshSeconds = 60\nif ($Settings.refreshSeconds) { $RefreshSeconds = [Math]::Max(20, [int]$Settings.refreshSeconds) }\n$MaxAgeMs = [Math]::Max(120000, $RefreshSeconds * 3000)\n$NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n\n$Cache = $null\nif (Test-Path -LiteralPath $CachePath) { $Cache = Get-Content -Raw -LiteralPath $CachePath | ConvertFrom-Json }\n$Profiles = @($Settings.accountProfiles | Where-Object { $_.providerId -eq $Provider -and $_.enabled -ne $false })\n\nfunction Get-CacheEntry([string]$Key) {\n  if (!$Cache -or !$Cache.providers) { return $null }\n  $Property = $Cache.providers.PSObject.Properties[$Key]\n  if ($Property) { return $Property.Value }\n  return $null\n}\n\nfunction Get-DefaultCacheEntry {\n  if (!$Cache -or !$Cache.providers) { return $null }\n  $Prefix = $Provider + ':'\n  $ProfilePrefix = $Provider + ':profile:'\n  $Matches = @($Cache.providers.PSObject.Properties | Where-Object { $_.Name.StartsWith($Prefix) -and !$_.Name.StartsWith($ProfilePrefix) } | ForEach-Object { $_.Value })\n  return $Matches | Sort-Object -Property savedAt -Descending | Select-Object -First 1\n}\n\n$Candidates = @()\n$Candidates += [pscustomobject]@{ Order = 0; Label = '기본 계정'; ConfigDir = $DefaultDirs[$Provider]; Entry = (Get-DefaultCacheEntry) }\n$Index = 1\nforeach ($Profile in $Profiles) {\n  $Key = $Provider + ':profile:' + [string]$Profile.id\n  $Candidates += [pscustomobject]@{ Order = $Index; Label = [string]$Profile.label; ConfigDir = [string]$Profile.configDir; Entry = (Get-CacheEntry $Key) }\n  $Index += 1\n}\n\nfunction Get-Remaining($Candidate) {\n  if (!$Candidate.Entry -or !$Candidate.Entry.provider) { return $null }\n  $Value = $Candidate.Entry.provider.routingRemainingPct\n  if ($null -eq $Value) { $Value = $Candidate.Entry.provider.remainingPct }\n  if ($null -eq $Value) { return $null }\n  return [double]$Value\n}\n\nfunction Test-FreshUsable($Candidate) {\n  if (!$Candidate.Entry -or !$Candidate.Entry.provider) { return $false }\n  if ($null -eq $Candidate.Entry.savedAt) { return $false }\n  if (($NowMs - [int64]$Candidate.Entry.savedAt) -gt $MaxAgeMs) { return $false }\n  if ($null -ne $Candidate.Entry.routeBlockedAt) { return $false }\n  if ($Candidate.Entry.provider.limitReached -eq $true) { return $false }\n  $Remaining = Get-Remaining $Candidate\n  if ($null -eq $Remaining) { return $false }\n  return $Remaining -gt $Threshold\n}\n\n$Selected = $null\nif ($Policy -eq 'fixed-primary') {\n  $Selected = $Candidates | Sort-Object Order | Select-Object -First 1\n} elseif ($Policy -eq 'max-remaining') {\n  $Selected = $Candidates | Where-Object { Test-FreshUsable $_ } | Sort-Object -Property @{ Expression = { Get-Remaining $_ }; Descending = $true }, @{ Expression = { $_.Order }; Ascending = $true } | Select-Object -First 1\n} else {\n  $Selected = $Candidates | Where-Object { Test-FreshUsable $_ } | Sort-Object Order | Select-Object -First 1\n}\n\nif (!$Selected) { throw ($Provider + ': 최신 사용량 기준으로 실행 가능한 계정을 찾지 못했습니다. 위젯을 새로고침하세요.') }\n$Remaining = Get-Remaining $Selected\nif ($null -ne $Remaining) { Write-Host (\"[How much is tokens] {0} -> {1} (라우팅 잔여 {2:N1}%)\" -f $Provider, $Selected.Label, $Remaining) } else { Write-Host (\"[How much is tokens] {0} -> {1}\" -f $Provider, $Selected.Label) }\n\nswitch ($Provider) {\n  'codex' { if ($Selected.ConfigDir) { $env:CODEX_HOME = $Selected.ConfigDir } }\n  'claude' { if ($Selected.ConfigDir) { $env:CLAUDE_CONFIG_DIR = $Selected.ConfigDir } }\n  'grok' { if ($Selected.ConfigDir) { $env:GROK_HOME = $Selected.ConfigDir } }\n}\n\n$OverrideName = @{ codex = 'CODEX_BIN'; claude = 'CLAUDE_BIN'; grok = 'GROK_BIN' }[$Provider]\n$Override = [Environment]::GetEnvironmentVariable($OverrideName)\nif ($Override) { & $Override } else { & $Provider }\nexit $LASTEXITCODE\n`;
}

function cmdLauncherScript(providerId) {
  return [
    "@echo off",
    "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0how-tokens-route.ps1\" " + providerId,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

function installRouterLaunchers(options = {}) {
  const binDir = String(options.binDir || "").trim();
  const stateDir = String(options.stateDir || "").trim();
  if (!binDir || !stateDir) return { ok: false, reason: "missing-path" };

  try {
    fs.mkdirSync(binDir, { recursive: true });
    const defaultDirs = {};
    for (const providerId of ROUTABLE_PROVIDERS) defaultDirs[providerId] = defaultConfigDir(providerId);

    const routerPath = path.join(binDir, "how-tokens-route.ps1");
    fs.writeFileSync(routerPath, powershellRouterScript(stateDir, defaultDirs), "utf8");
    const files = [routerPath];

    for (const providerId of ROUTABLE_PROVIDERS) {
      const filePath = path.join(binDir, `${providerId}-auto.cmd`);
      fs.writeFileSync(filePath, cmdLauncherScript(providerId), "utf8");
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
      "라우터는 settings.json과 usage-cache.json을 읽고 최신 계정을 선택합니다.",
      "priority/max 정책은 오래된 cache, 최근 조회 실패, limit-reached 계정을 사용하지 않습니다.",
      "Codex/Claude는 모델별 scoped quota가 아니라 전역 quota 중 가장 낮은 잔여율을 기준으로 선택합니다.",
      "이미 실행 중인 CLI 세션의 계정은 변경하지 않습니다.",
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
  commandOutput,
  resolveProviderExecutable,
  cmdQuotedPath,
  interactiveStartCommand,
  launchRoutedCli,
  psLiteral,
  powershellRouterScript,
  cmdLauncherScript,
  installRouterLaunchers,
};
