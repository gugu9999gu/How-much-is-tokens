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
  cursor: ["agent", "cursor-agent"],
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

  const commands = PROVIDER_COMMANDS[providerId] || [];
  const platform = options.platform || process.platform;
  for (const command of commands) {
    const output = platform === "win32"
      ? commandOutput("where.exe", [command], env, options.execFileSyncImpl)
      : commandOutput("which", [command], env, options.execFileSyncImpl);
    const resolved = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const preferred = platform === "win32"
      ? (resolved.find((value) => /\.(?:exe|com)$/i.test(value)) || resolved.find((value) => /\.(?:cmd|bat)$/i.test(value)) || resolved[0])
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
  const cwd = options.cwd || process.cwd();
  const commandLine = interactiveStartCommand(executable, comspec, PROVIDER_ARGS[providerId] || []);
  if (!commandLine) return { ok: false, reason: "invalid-executable-path", providerId };

  try {
    const child = spawnImpl(comspec, ["/d", "/s", "/c", commandLine], {
      cwd,
      env,
      detached: true,
      windowsVerbatimArguments: true,
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

function psLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function powershellRouterScript(stateDir, defaultDirs = {}) {
  const state = psLiteral(stateDir);
  const defaults = JSON.stringify(defaultDirs || {}).replace(/'/g, "''");
  const providers = ROUTABLE_PROVIDERS.map((id) => `'${id}'`).join(",");
  return `param(\n  [Parameter(Mandatory = $true)]\n  [ValidateSet(${providers})]\n  [string]$Provider\n)\n\n$ErrorActionPreference = 'Stop'\n$StateDir = ${state}\n$SettingsPath = Join-Path $StateDir 'settings.json'\n$CachePath = Join-Path $StateDir 'usage-cache.json'\n$DefaultDirs = ConvertFrom-Json '${defaults}'\nif (!(Test-Path -LiteralPath $SettingsPath)) { throw 'How much is tokens settings.json을 찾을 수 없습니다.' }\n$Settings = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json\n$Routing = $Settings.smartRouting.$Provider\nif (!$Routing -or $Routing.enabled -ne $true) { throw \"$Provider Smart Routing이 꺼져 있습니다.\" }\n$Policy = [string]$Routing.policy\n$Threshold = if ($null -ne $Routing.thresholdPct) { [double]$Routing.thresholdPct } else { 0.0 }\n$RefreshSeconds = if ($Settings.refreshSeconds) { [Math]::Max(20, [int]$Settings.refreshSeconds) } else { 60 }\n$MaxAgeMs = [Math]::Max(120000, $RefreshSeconds * 3000)\n$NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n$Cache = if (Test-Path -LiteralPath $CachePath) { Get-Content -Raw -LiteralPath $CachePath | ConvertFrom-Json } else { $null }\nfunction Get-Entry([string]$Key) { if (!$Cache -or !$Cache.providers) { return $null }; $p=$Cache.providers.PSObject.Properties[$Key]; if($p){$p.Value}else{$null} }\nfunction Get-Remaining($Candidate) { if(!$Candidate.Entry -or !$Candidate.Entry.provider){return $null}; $v=$Candidate.Entry.provider.routingRemainingPct; if($null -eq $v){$v=$Candidate.Entry.provider.remainingPct}; if($null -eq $v){return $null}; [double]$v }\nfunction Test-Usable($Candidate) { if(!$Candidate.Entry -or !$Candidate.Entry.provider){return $false}; if($null -eq $Candidate.Entry.savedAt){return $false}; if(($NowMs-[int64]$Candidate.Entry.savedAt)-gt $MaxAgeMs){return $false}; if($null-ne $Candidate.Entry.routeBlockedAt){return $false}; if($Candidate.Entry.provider.limitReached-eq $true){return $false}; $r=Get-Remaining $Candidate; return $null-ne $r -and $r-gt $Threshold }\n$Candidates=@()\nif($Provider -eq 'antigravity') {\n  if($Cache -and $Cache.providers){ $i=0; foreach($p in $Cache.providers.PSObject.Properties){ $r=$p.Value.provider; if($r -and $r.providerId -eq 'antigravity' -and $r.externalAccountRef){ $Candidates += [pscustomobject]@{Order=$i;Label=[string]$r.accountLabel;AccountRef=[string]$r.externalAccountRef;ConfigDir='';Entry=$p.Value}; $i++ } } }\n} else {\n  $Profiles=@($Settings.accountProfiles | Where-Object { $_.providerId -eq $Provider -and $_.enabled -ne $false })\n  $DefaultEntry=$null; if($Cache -and $Cache.providers){ $Prefix=$Provider+':';$ProfilePrefix=$Provider+':profile:';$DefaultEntry=$Cache.providers.PSObject.Properties|Where-Object{$_.Name.StartsWith($Prefix)-and !$_.Name.StartsWith($ProfilePrefix)}|ForEach-Object{$_.Value}|Sort-Object savedAt -Descending|Select-Object -First 1 }\n  $DefaultDir=[string]$DefaultDirs.$Provider\n  $Candidates += [pscustomobject]@{Order=0;Label='기본 계정';ConfigDir=$DefaultDir;AccountRef='';Entry=$DefaultEntry}\n  $i=1; foreach($Profile in $Profiles){$Key=$Provider+':profile:'+[string]$Profile.id;$Candidates += [pscustomobject]@{Order=$i;Label=[string]$Profile.label;ConfigDir=[string]$Profile.configDir;AccountRef='';Entry=(Get-Entry $Key)};$i++}\n}\n$Selected=$null\nif($Policy-eq 'fixed-primary'){$Selected=$Candidates|Sort-Object Order|Select-Object -First 1}elseif($Policy-eq 'max-remaining'){$Selected=$Candidates|Where-Object{Test-Usable $_}|Sort-Object -Property @{Expression={Get-Remaining $_};Descending=$true},@{Expression={$_.Order};Ascending=$true}|Select-Object -First 1}else{$Selected=$Candidates|Where-Object{Test-Usable $_}|Sort-Object Order|Select-Object -First 1}\nif(!$Selected){throw ($Provider+': 실행 가능한 최신 계정을 찾지 못했습니다. 위젯을 새로고침하세요.')}\n$r=Get-Remaining $Selected; if($null-ne $r){Write-Host (\"[How much is tokens] {0} -> {1} ({2:N1}%)\" -f $Provider,$Selected.Label,$r)}\nswitch($Provider){'codex'{if($Selected.ConfigDir){$env:CODEX_HOME=$Selected.ConfigDir}};'claude'{if($Selected.ConfigDir){$env:CLAUDE_CONFIG_DIR=$Selected.ConfigDir}};'grok'{if($Selected.ConfigDir){$env:GROK_HOME=$Selected.ConfigDir}};'cursor'{if($Selected.ConfigDir){$env:CURSOR_CONFIG_DIR=$Selected.ConfigDir}};'copilot'{if($Selected.ConfigDir){$env:GH_CONFIG_DIR=$Selected.ConfigDir}};'antigravity'{if(!$Selected.AccountRef){throw 'Antigravity 계정 식별자가 없습니다.'}; & agm switch $Selected.AccountRef --target agy; if($LASTEXITCODE-ne 0){throw 'agm 계정 전환 실패'}}}\nswitch($Provider){'codex'{& $(if($env:CODEX_BIN){$env:CODEX_BIN}else{'codex'})};'claude'{& $(if($env:CLAUDE_BIN){$env:CLAUDE_BIN}else{'claude'})};'grok'{& $(if($env:GROK_BIN){$env:GROK_BIN}else{'grok'})};'cursor'{& $(if($env:CURSOR_BIN){$env:CURSOR_BIN}else{'agent'})};'copilot'{& $(if($env:GH_BIN){$env:GH_BIN}else{'gh'}) copilot};'antigravity'{& $(if($env:AGY_BIN){$env:AGY_BIN}else{'agy'})}}\nexit $LASTEXITCODE\n`;
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
      "Antigravity 다계정 전환은 설치된 agm의 암호화 계정 저장소를 사용하며 앱이 OAuth 토큰을 직접 복사하지 않습니다.",
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
