const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { profileEnvironment, defaultConfigDir } = require("./account-profiles");
const { ROUTABLE_PROVIDERS } = require("./account-router");
const { resolvedAgm } = require("./antigravity-account-manager");

const PROVIDER_COMMANDS = {
  codex: ["codex"],
  claude: ["claude"],
  grok: ["grok"],
  cursor: ["cursor-agent", "agent"],
  copilot: ["gh"],
  antigravity: ["agy"],
};

const PROVIDER_ARGS = {
  copilot: ["copilot"],
};

const PROVIDER_BIN_ENV = {
  codex: "CODEX_BIN",
  claude: "CLAUDE_BIN",
  grok: "GROK_BIN",
  cursor: "CURSOR_BIN",
  copilot: "GH_BIN",
  antigravity: "AGY_BIN",
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

  const platform = options.platform || process.platform;
  for (const command of PROVIDER_COMMANDS[providerId] || []) {
    const output = platform === "win32"
      ? commandOutput("where.exe", [command], env, options.execFileSyncImpl)
      : commandOutput("which", [command], env, options.execFileSyncImpl);
    const resolved = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const preferred = platform === "win32"
      ? (resolved.find((value) => /\.(?:exe|com)$/i.test(value))
        || resolved.find((value) => /\.(?:cmd|bat)$/i.test(value))
        || resolved[0])
      : resolved[0];
    if (preferred) return preferred;
  }
  return null;
}

function cmdQuotedPath(value) {
  const text = String(value || "");
  if (!text || /[\r\n"]/.test(text)) return null;
  return `"${text}"`;
}

function safeArg(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9._:/=-]+$/.test(text) ? text : null;
}

function interactiveStartCommand(executable, comspec, args = []) {
  const exe = cmdQuotedPath(executable);
  const shell = cmdQuotedPath(comspec);
  const safeArgs = (Array.isArray(args) ? args : []).map(safeArg);
  if (!exe || !shell || safeArgs.some((arg) => !arg)) return null;
  const suffix = safeArgs.length ? ` ${safeArgs.join(" ")}` : "";
  return `start "" ${shell} /d /k call ${exe}${suffix}`;
}

function switchAntigravityProfile(profile, options = {}) {
  if (!profile || profile.externalManager !== "agm" || !profile.accountRef) return { ok: true };
  const agm = options.agmExecutable || resolvedAgm(options);
  if (!agm) return { ok: false, reason: "account-manager-required" };
  try {
    (options.execFileSyncImpl || execFileSync)(agm, ["switch", String(profile.accountRef), "--target", "agy"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "account-switch-failed", error: err.message || String(err) };
  }
}

function applyDefaultEnvironment(providerId, env) {
  const defaultDir = defaultConfigDir(providerId);
  if (providerId === "codex" && defaultDir) env.CODEX_HOME = defaultDir;
  if (providerId === "claude" && defaultDir) env.CLAUDE_CONFIG_DIR = defaultDir;
  if (providerId === "grok" && defaultDir) env.GROK_HOME = defaultDir;
  if (providerId === "cursor" && defaultDir) env.CURSOR_CONFIG_DIR = defaultDir;
  if (providerId === "copilot" && defaultDir) env.GH_CONFIG_DIR = defaultDir;
  return env;
}

function launchRoutedCli(providerId, profile, options = {}) {
  if (!ROUTABLE_PROVIDERS.includes(providerId)) {
    return { ok: false, reason: "unsupported-provider", providerId };
  }
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return { ok: false, reason: "unsupported-platform", providerId };
  }

  const env = profile ? profileEnvironment(profile) : applyDefaultEnvironment(providerId, { ...process.env });
  if (providerId === "antigravity") {
    const switched = switchAntigravityProfile(profile, { ...options, env });
    if (!switched.ok) return { ...switched, providerId };
  }

  const executable = options.executable || resolveProviderExecutable(providerId, {
    env,
    platform,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  if (!executable) return { ok: false, reason: "cli-not-found", providerId };

  const spawnImpl = options.spawnImpl || spawn;
  const comspec = options.comspec || env.ComSpec || process.env.ComSpec || "cmd.exe";
  const commandLine = interactiveStartCommand(executable, comspec, PROVIDER_ARGS[providerId] || []);
  if (!commandLine) return { ok: false, reason: "invalid-executable-path", providerId };

  try {
    const child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
      cwd: options.cwd || process.cwd(),
      env,
      detached: true,
      windowsVerbatimArguments: true,
      // This process launches a new interactive console through START. Keeping
      // the Windows console visible avoids the same hidden-login failure mode
      // that affected credential login launchers.
      windowsHide: false,
      stdio: "ignore",
    });
    if (child && typeof child.unref === "function") child.unref();
  } catch (err) {
    return { ok: false, reason: "spawn-failed", providerId, error: err.message || String(err) };
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
  const defaults = JSON.stringify(defaultDirs || {}).replace(/'/g, "''");
  const providers = ROUTABLE_PROVIDERS.map((id) => `'${id}'`).join(",");
  return `param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(${providers})]
  [string]$Provider
)

$ErrorActionPreference = 'Stop'
$StateDir = ${state}
$SettingsPath = Join-Path $StateDir 'settings.json'
$CachePath = Join-Path $StateDir 'usage-cache.json'
$DefaultDirs = ConvertFrom-Json '${defaults}'
if (!(Test-Path -LiteralPath $SettingsPath)) { throw 'How much is tokens settings.json을 찾을 수 없습니다.' }
$Settings = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
$Routing = $Settings.smartRouting.$Provider
if (!$Routing -or $Routing.enabled -ne $true) { throw "$Provider Smart Routing이 꺼져 있습니다." }
$Policy = [string]$Routing.policy
$Threshold = if ($null -ne $Routing.thresholdPct) { [double]$Routing.thresholdPct } else { 0.0 }
$RefreshSeconds = if ($Settings.refreshSeconds) { [Math]::Max(20, [int]$Settings.refreshSeconds) } else { 60 }
$MaxAgeMs = [Math]::Max(120000, $RefreshSeconds * 3000)
$NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$Cache = if (Test-Path -LiteralPath $CachePath) { Get-Content -Raw -LiteralPath $CachePath | ConvertFrom-Json } else { $null }

function Get-Entry([string]$Key) {
  if (!$Cache -or !$Cache.providers) { return $null }
  $Property = $Cache.providers.PSObject.Properties[$Key]
  if ($Property) { return $Property.Value }
  return $null
}

function Get-Remaining($Candidate) {
  if (!$Candidate.Entry -or !$Candidate.Entry.provider) { return $null }
  $Value = $Candidate.Entry.provider.routingRemainingPct
  if ($null -eq $Value) { $Value = $Candidate.Entry.provider.remainingPct }
  if ($null -eq $Value) { return $null }
  return [double]$Value
}

function Test-Usable($Candidate) {
  if (!$Candidate.Entry -or !$Candidate.Entry.provider) { return $false }
  if ($null -eq $Candidate.Entry.savedAt) { return $false }
  if (($NowMs - [int64]$Candidate.Entry.savedAt) -gt $MaxAgeMs) { return $false }
  if ($null -ne $Candidate.Entry.routeBlockedAt) { return $false }
  if ($Candidate.Entry.provider.limitReached -eq $true) { return $false }
  $Remaining = Get-Remaining $Candidate
  return $null -ne $Remaining -and $Remaining -gt $Threshold
}

function Get-StableAccountKey([string]$ProviderId, [string]$Identity) {
  if ([string]::IsNullOrWhiteSpace($Identity)) { return ($ProviderId + ':default') }
  $Text = $ProviderId.ToLowerInvariant() + [char]0 + $Identity.Trim().ToLowerInvariant()
  $Sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Hash = $Sha.ComputeHash($Bytes)
    $Hex = -join ($Hash | ForEach-Object { $_.ToString('x2') })
    return ($ProviderId.ToLowerInvariant() + ':' + $Hex.Substring(0, 16))
  } finally {
    $Sha.Dispose()
  }
}

function Resolve-Agm {
  $Command = Get-Command agm -ErrorAction SilentlyContinue
  if ($Command) { return $Command.Source }
  $Go = Get-Command go -ErrorAction SilentlyContinue
  if (!$Go) { return $null }
  $Bin = (& $Go.Source env GOBIN 2>$null | Select-Object -First 1).Trim()
  if (!$Bin) {
    $GoPath = (& $Go.Source env GOPATH 2>$null | Select-Object -First 1).Trim()
    if ($GoPath) { $Bin = Join-Path (($GoPath -split [IO.Path]::PathSeparator)[0]) 'bin' }
  }
  if (!$Bin) { return $null }
  $Candidate = Join-Path $Bin 'agm.exe'
  if (Test-Path -LiteralPath $Candidate) { return $Candidate }
  return $null
}

$Candidates = @()
if ($Provider -eq 'antigravity') {
  if ($Cache -and $Cache.providers) {
    foreach ($Property in $Cache.providers.PSObject.Properties) {
      $Row = $Property.Value.provider
      if ($Row -and $Row.providerId -eq 'antigravity' -and $Row.managedBy -eq 'agm' -and $Row.accountKey) {
        $Order = if ($null -ne $Row.accountOrder) { [int]$Row.accountOrder } else { 9999 }
        $Candidates += [pscustomobject]@{
          Order = $Order
          Label = ('Antigravity ' + ($Order + 1))
          ConfigDir = ''
          AccountKey = [string]$Row.accountKey
          Entry = $Property.Value
        }
      }
    }
  }
} else {
  $Profiles = @($Settings.accountProfiles | Where-Object { $_.providerId -eq $Provider -and $_.enabled -ne $false })
  $DefaultEntry = $null
  if ($Cache -and $Cache.providers) {
    $Prefix = $Provider + ':'
    $ProfilePrefix = $Provider + ':profile:'
    $DefaultEntry = $Cache.providers.PSObject.Properties |
      Where-Object { $_.Name.StartsWith($Prefix) -and !$_.Name.StartsWith($ProfilePrefix) } |
      ForEach-Object { $_.Value } |
      Sort-Object savedAt -Descending |
      Select-Object -First 1
  }
  $DefaultDir = [string]$DefaultDirs.$Provider
  $Candidates += [pscustomobject]@{ Order=0; Label='기본 계정'; ConfigDir=$DefaultDir; AccountKey=''; Entry=$DefaultEntry }
  $Index = 1
  foreach ($Profile in $Profiles) {
    $Key = $Provider + ':profile:' + [string]$Profile.id
    $Candidates += [pscustomobject]@{ Order=$Index; Label=[string]$Profile.label; ConfigDir=[string]$Profile.configDir; AccountKey=''; Entry=(Get-Entry $Key) }
    $Index += 1
  }
}

$Selected = $null
if ($Policy -eq 'fixed-primary') {
  $Selected = $Candidates | Sort-Object Order | Select-Object -First 1
} elseif ($Policy -eq 'max-remaining') {
  $Selected = $Candidates | Where-Object { Test-Usable $_ } |
    Sort-Object -Property @{ Expression={ Get-Remaining $_ }; Descending=$true }, @{ Expression={ $_.Order }; Ascending=$true } |
    Select-Object -First 1
} else {
  $Selected = $Candidates | Where-Object { Test-Usable $_ } | Sort-Object Order | Select-Object -First 1
}
if (!$Selected) { throw ($Provider + ': 실행 가능한 최신 계정을 찾지 못했습니다. 위젯을 새로고침하세요.') }

$Remaining = Get-Remaining $Selected
if ($null -ne $Remaining) { Write-Host ("[How much is tokens] {0} -> {1} ({2:N1}%)" -f $Provider, $Selected.Label, $Remaining) }

switch ($Provider) {
  'codex' { if ($Selected.ConfigDir) { $env:CODEX_HOME = $Selected.ConfigDir } }
  'claude' { if ($Selected.ConfigDir) { $env:CLAUDE_CONFIG_DIR = $Selected.ConfigDir } }
  'grok' { if ($Selected.ConfigDir) { $env:GROK_HOME = $Selected.ConfigDir } }
  'cursor' { if ($Selected.ConfigDir) { $env:CURSOR_CONFIG_DIR = $Selected.ConfigDir } }
  'copilot' { if ($Selected.ConfigDir) { $env:GH_CONFIG_DIR = $Selected.ConfigDir } }
  'antigravity' {
    $Agm = Resolve-Agm
    if (!$Agm) { throw 'Antigravity 다계정 도우미 agm을 찾을 수 없습니다.' }
    $Account = $null
    foreach ($Line in @(& $Agm list 2>$null)) {
      $Trimmed = [string]$Line
      if ($Trimmed -notmatch '^\s*(\S+@\S+)\s+') { continue }
      $Email = $Matches[1]
      if ((Get-StableAccountKey 'antigravity' $Email) -eq $Selected.AccountKey) {
        $Account = $Email
        break
      }
    }
    if (!$Account) { throw 'Antigravity 계정 목록과 위젯 cache를 일치시킬 수 없습니다. 새로고침하세요.' }
    & $Agm switch $Account --target agy
    if ($LASTEXITCODE -ne 0) { throw 'agm 계정 전환 실패' }
  }
}

switch ($Provider) {
  'codex' { & $(if ($env:CODEX_BIN) { $env:CODEX_BIN } else { 'codex' }) }
  'claude' { & $(if ($env:CLAUDE_BIN) { $env:CLAUDE_BIN } else { 'claude' }) }
  'grok' { & $(if ($env:GROK_BIN) { $env:GROK_BIN } else { 'grok' }) }
  'cursor' { & $(if ($env:CURSOR_BIN) { $env:CURSOR_BIN } else { 'agent' }) }
  'copilot' { & $(if ($env:GH_BIN) { $env:GH_BIN } else { 'gh' }) copilot }
  'antigravity' { & $(if ($env:AGY_BIN) { $env:AGY_BIN } else { 'agy' }) }
}
exit $LASTEXITCODE
`;
}

function cmdLauncherScript(providerId) {
  return [
    "@echo off",
    `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0how-tokens-route.ps1" ${providerId}`,
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
    for (const providerId of ROUTABLE_PROVIDERS) defaultDirs[providerId] = defaultConfigDir(providerId) || "";

    const routerPath = path.join(binDir, "how-tokens-route.ps1");
    fs.writeFileSync(routerPath, `\uFEFF${powershellRouterScript(stateDir, defaultDirs)}`, "utf8");
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
      ...ROUTABLE_PROVIDERS.map((id) => `${id}-auto.cmd - 최신 사용량과 설정 정책으로 계정 선택 후 새 CLI 실행`),
      "",
      "Cursor는 CURSOR_CONFIG_DIR, Copilot은 GH_CONFIG_DIR로 격리합니다.",
      "Antigravity 다계정 전환은 선택 계정의 해시와 agm의 암호화 계정 목록을 실행 시점에 대조합니다.",
      "이메일/OAuth 토큰 원문은 위젯 usage-cache에 저장하지 않습니다.",
      "오래된 cache, 최근 조회 실패, limit-reached 계정은 자동 정책에서 제외됩니다.",
      "이미 실행 중인 CLI 프로세스의 인증을 중간에 덮어쓰지는 않습니다.",
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
  PROVIDER_ARGS,
  PROVIDER_BIN_ENV,
  commandOutput,
  resolveProviderExecutable,
  cmdQuotedPath,
  safeArg,
  interactiveStartCommand,
  switchAntigravityProfile,
  applyDefaultEnvironment,
  launchRoutedCli,
  psLiteral,
  powershellRouterScript,
  cmdLauncherScript,
  installRouterLaunchers,
};
