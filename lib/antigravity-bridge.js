const fs = require("fs");
const path = require("path");
const { home, appData, exists, readJson, writeJson } = require("./paths");

const MARKER = "how-much-is-tokens-antigravity-statusline.ps1";

function antigravitySettingsPath() {
  return path.join(home(), ".gemini", "antigravity-cli", "settings.json");
}

function bridgeDir() {
  return path.join(appData(), "how-much-is-tokens");
}

function bridgePath() {
  return path.join(bridgeDir(), MARKER);
}

function snapshotPath() {
  return path.join(bridgeDir(), "antigravity-status.json");
}

function escapePsSingle(value) {
  return String(value).replace(/'/g, "''");
}

function powershellBridgeScript() {
  const target = escapePsSingle(snapshotPath());
  return `$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
  $payload = $raw | ConvertFrom-Json
} catch {
  exit 0
}

$email = [string]$payload.email
if ([string]::IsNullOrWhiteSpace($email)) { $email = 'unknown' }
$normalized = $email.Trim().ToLowerInvariant()

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $hashBytes = $sha.ComputeHash($bytes)
  $accountId = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
  $accountId = $accountId.Substring(0, 12)
} finally {
  $sha.Dispose()
}

function Mask-Email([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value) -or $value -eq 'unknown') { return 'Google account' }
  $parts = $value.Split('@', 2)
  if ($parts.Count -ne 2) {
    if ($value.Length -le 2) { return ($value.Substring(0, 1) + '*') }
    return ($value.Substring(0, 2) + '***')
  }
  $local = $parts[0]
  $domain = $parts[1]
  if ($local.Length -le 1) { $maskedLocal = $local + '***' }
  elseif ($local.Length -eq 2) { $maskedLocal = $local.Substring(0, 1) + '***' }
  else { $maskedLocal = $local.Substring(0, 2) + '***' }
  return ($maskedLocal + '@' + $domain)
}

$quota = [ordered]@{}
if ($null -ne $payload.quota) {
  foreach ($prop in $payload.quota.PSObject.Properties) {
    $q = $prop.Value
    $remaining = $null
    if ($null -ne $q.remaining_fraction) {
      try { $remaining = [double]$q.remaining_fraction } catch { $remaining = $null }
    }
    $resetIn = $null
    if ($null -ne $q.reset_in_seconds) {
      try { $resetIn = [double]$q.reset_in_seconds } catch { $resetIn = $null }
    }
    $quota[$prop.Name] = [ordered]@{
      remaining_fraction = $remaining
      reset_time = if ($null -ne $q.reset_time) { [string]$q.reset_time } else { $null }
      reset_in_seconds = $resetIn
      disabled = if ($null -ne $q.disabled) { [bool]$q.disabled } else { $false }
    }
  }
}

$now = (Get-Date).ToUniversalTime().ToString('o')
$record = [ordered]@{
  id = $accountId
  label = (Mask-Email $email)
  plan = if ($null -ne $payload.plan_tier) { [string]$payload.plan_tier } else { $null }
  cliVersion = if ($null -ne $payload.version) { [string]$payload.version } else { $null }
  observedAt = $now
  quota = $quota
}

$accounts = @()
if (Test-Path -LiteralPath '${target}') {
  try {
    $old = [System.IO.File]::ReadAllText('${target}', [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($null -ne $old.accounts) {
      $accounts = @($old.accounts | Where-Object { [string]$_.id -ne $accountId })
    }
  } catch {
    $accounts = @()
  }
}
$accounts += [pscustomobject]$record

$out = [ordered]@{
  version = 1
  source = 'antigravity-statusline'
  updatedAt = $now
  activeAccountId = $accountId
  accounts = $accounts
}

try {
  $dir = [System.IO.Path]::GetDirectoryName('${target}')
  [System.IO.Directory]::CreateDirectory($dir) | Out-Null
  $tmp = '${target}.tmp'
  $json = $out | ConvertTo-Json -Depth 10 -Compress
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $json, $utf8)
  Move-Item -LiteralPath $tmp -Destination '${target}' -Force
} catch {
  exit 0
}

# Keep the custom line visually empty. stack_with_default=true preserves AGY's
# built-in status line, including its own AI Credits indicator.
[Console]::Out.Write('')
`;
}

function commandForBridge() {
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${bridgePath()}"`;
}

function ensureBridgeInstalled() {
  if (process.platform !== "win32") {
    return {
      ok: false,
      reason: "unsupported-platform",
      hint: "현재 자동 Antigravity status-line 연결은 Windows 빌드에서 지원합니다.",
    };
  }

  const settingsFile = antigravitySettingsPath();
  if (!exists(settingsFile)) {
    return {
      ok: false,
      reason: "settings-missing",
      hint: "Antigravity CLI(agy)를 한 번 실행한 뒤 다시 새로고침하세요.",
    };
  }

  const settings = readJson(settingsFile);
  if (!settings || typeof settings !== "object") {
    return {
      ok: false,
      reason: "settings-invalid",
      hint: "Antigravity CLI settings.json을 읽을 수 없습니다.",
    };
  }

  const existing = settings.statusLine && typeof settings.statusLine === "object" ? settings.statusLine : {};
  const existingCommand = typeof existing.command === "string" ? existing.command : "";
  if (existingCommand && !existingCommand.includes(MARKER)) {
    return {
      ok: false,
      reason: "statusline-conflict",
      conflict: true,
      hint: "기존 Antigravity 사용자 status-line 명령이 있어 자동으로 덮어쓰지 않았습니다.",
    };
  }

  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.writeFileSync(bridgePath(), powershellBridgeScript(), "utf8");

  const desired = {
    ...existing,
    type: "command",
    command: commandForBridge(),
    enabled: true,
    stack_with_default: true,
  };

  const changed =
    existing.type !== desired.type ||
    existing.command !== desired.command ||
    existing.enabled !== true ||
    existing.stack_with_default !== true;

  if (changed) {
    const next = { ...settings, statusLine: desired };
    writeJson(settingsFile, next);
  }

  return {
    ok: true,
    changed,
    settingsPath: settingsFile,
    bridgePath: bridgePath(),
    snapshotPath: snapshotPath(),
  };
}

module.exports = {
  MARKER,
  antigravitySettingsPath,
  bridgePath,
  snapshotPath,
  commandForBridge,
  ensureBridgeInstalled,
};
