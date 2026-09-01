const path = require("path");
const { execFileSync } = require("child_process");
const { home, exists, readJson } = require("../paths");
const { requestJson, num } = require("../http");
const { parseTime, remainingFromUsed } = require("../time");

const ID = "antigravity";
const NAME = "Antigravity";
const BRAND = "#7c6cff";
const KEYRING_TARGET = "gemini:antigravity";

function normalizeCredential(blob, source) {
  const token = (blob && blob.token) || blob || {};
  return {
    source,
    accessToken: token.access_token || null,
    expiry: parseTime(token.expiry || token.expiry_date),
  };
}

function readWindowsCredential() {
  const ps = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sig = @'
using System;
using System.Runtime.InteropServices;
public class TokenWidgetCredential {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=false)]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static byte[] Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
      return bytes;
    } finally { CredFree(p); }
  }
}
'@
Add-Type -TypeDefinition $sig | Out-Null
$b = [TokenWidgetCredential]::Read('${KEYRING_TARGET}')
if ($b -eq $null) { exit 3 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($b))
`.trim();

  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const start = output.indexOf("{");
  if (start < 0) return null;
  return JSON.parse(output.slice(start));
}

function antigravityInstalled() {
  if (exists(path.join(home(), ".gemini", "antigravity-cli", "settings.json"))) return true;
  if (exists(path.join(home(), ".gemini", "antigravity-cli", "antigravity-oauth-token"))) return true;
  const local = process.env.LOCALAPPDATA;
  if (local && exists(path.join(local, "agy", "bin", process.platform === "win32" ? "agy.exe" : "agy"))) return true;
  return false;
}

function readFileCredential() {
  const candidates = [path.join(home(), ".gemini", "antigravity-cli", "antigravity-oauth-token")];
  if (antigravityInstalled()) candidates.push(path.join(home(), ".gemini", "oauth_creds.json"));
  for (const file of candidates) {
    if (!exists(file)) continue;
    const blob = readJson(file);
    if (blob) return { blob, source: file.endsWith("antigravity-oauth-token") ? "antigravity-token-file" : "gemini-oauth-file" };
  }
  return null;
}

function loadCredential() {
  if (process.platform === "win32") {
    try {
      const blob = readWindowsCredential();
      if (blob) return normalizeCredential(blob, "windows-keyring");
    } catch {
      // Fall through to file-based credentials. Containers and older installs may use them.
    }
  }
  const file = readFileCredential();
  return file ? normalizeCredential(file.blob, file.source) : null;
}

function pctFromFraction(value) {
  const frac = num(value);
  if (frac == null) return null;
  return Math.max(0, Math.min(100, frac * 100));
}

function windowFromFraction(id, label, fraction, resetTime) {
  const remainingPct = pctFromFraction(fraction);
  if (remainingPct == null) return null;
  return {
    id,
    label,
    remainingPct,
    usedPct: remainingFromUsed(remainingPct),
    resetAt: parseTime(resetTime),
  };
}

function poolKey(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.startsWith("gemini") || id.startsWith("tab")) return "google";
  if (id.startsWith("claude") || id.includes("anthropic")) return "vertex";
  if (id.startsWith("gpt") || id.includes("openai") || id.includes("oss") || /^o[1-9]/.test(id)) return "vertex";
  return "other";
}

function buildPoolWindows(payload) {
  const models = (payload && payload.models) || {};
  const groups = new Map();
  for (const [modelId, model] of Object.entries(models)) {
    if (!model || model.isInternal || /^tab[_-]/i.test(modelId)) continue;
    const fraction = num(model.quotaInfo && model.quotaInfo.remainingFraction);
    if (fraction == null) continue;
    const key = poolKey(modelId);
    const entry = groups.get(key) || { fractions: [], resets: [] };
    entry.fractions.push(fraction);
    if (model.quotaInfo && model.quotaInfo.resetTime) entry.resets.push(model.quotaInfo.resetTime);
    groups.set(key, entry);
  }

  const labels = {
    google: "Gemini 공유 풀",
    vertex: "Claude/GPT 공유 풀",
    other: "기타 모델 풀",
  };
  const windows = [];
  for (const [key, group] of groups.entries()) {
    const fraction = Math.min(...group.fractions);
    const resetTime = group.resets.sort()[0] || null;
    const win = windowFromFraction(`pool-${key}`, labels[key] || "모델 풀", fraction, resetTime);
    if (win) windows.push(win);
  }
  return windows;
}

function buildRequestWindows(payload) {
  const buckets = (payload && payload.buckets) || [];
  return buckets.map((bucket, index) => {
    const modelId = bucket.modelId || `model-${index + 1}`;
    return windowFromFraction(`request-${modelId}`, modelId, bucket.remainingFraction, bucket.resetTime);
  }).filter(Boolean);
}

function pickTightest(windows) {
  return [...windows]
    .filter((win) => win.remainingPct != null)
    .sort((a, b) => a.remainingPct - b.remainingPct || (a.resetAt || Infinity) - (b.resetAt || Infinity))[0] || null;
}

async function post(endpoint, accessToken, body, extraHeaders = {}) {
  return requestJson(`https://cloudcode-pa.googleapis.com/v1internal:${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform: process.platform === "win32" ? "WINDOWS" : "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      ...extraHeaders,
    },
    body: body || {},
  });
}

async function fetchUsage() {
  const credential = loadCredential();
  if (!credential || !credential.accessToken) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "missing",
      hint: "Antigravity에서 Google 계정으로 로그인한 뒤 agy를 한 번 실행하세요.",
    };
  }

  if (credential.expiry && credential.expiry <= Date.now()) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Antigravity 세션이 만료되었습니다. agy를 실행해 로그인 세션을 갱신하세요.",
    };
  }

  const loaded = await post("loadCodeAssist", credential.accessToken, {});
  if (loaded.status === 401) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Antigravity 인증이 만료되었습니다. agy를 실행해 세션을 갱신하세요.",
    };
  }

  const loadJson = loaded.ok && loaded.json ? loaded.json : {};
  const project = loadJson.cloudaicompanionProject || null;
  const requestBody = project ? { project } : {};
  const [quota, available] = await Promise.all([
    post("retrieveUserQuota", credential.accessToken, requestBody),
    post("fetchAvailableModels", credential.accessToken, requestBody),
  ]);

  if ([quota.status, available.status].includes(401)) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "login",
      hint: "Antigravity 인증이 만료되었습니다. agy를 실행해 세션을 갱신하세요.",
    };
  }

  const requestWindows = quota.ok && quota.json ? buildRequestWindows(quota.json) : [];
  const poolWindows = available.ok && available.json ? buildPoolWindows(available.json) : [];
  const windows = [...requestWindows, ...poolWindows].sort((a, b) =>
    (a.remainingPct ?? 101) - (b.remainingPct ?? 101) || (a.resetAt || Infinity) - (b.resetAt || Infinity)
  );
  const tightest = pickTightest(windows);

  if (!windows.length && !loaded.ok) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: loaded.error || quota.error || available.error || `HTTP ${loaded.status || quota.status || available.status}`,
    };
  }
  if (!windows.length && !quota.ok && !available.ok) {
    return {
      id: ID,
      name: NAME,
      brand: BRAND,
      status: "error",
      error: quota.error || available.error || `quota HTTP ${quota.status}, models HTTP ${available.status}`,
    };
  }

  const plan = loadJson.currentTier && (loadJson.currentTier.name || loadJson.currentTier.id);
  const extras = [];
  if (credential.source === "windows-keyring") extras.push({ label: "인증", value: "Windows 계정" });
  else if (credential.source === "antigravity-token-file") extras.push({ label: "인증", value: "Antigravity CLI" });

  return {
    id: ID,
    name: NAME,
    brand: BRAND,
    status: "ok",
    plan,
    remainingPct: tightest ? tightest.remainingPct : null,
    usedPct: tightest ? tightest.usedPct : null,
    resetAt: tightest ? tightest.resetAt : null,
    windows,
    extras,
  };
}

module.exports = { id: ID, fetchUsage };
