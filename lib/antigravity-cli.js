const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { home } = require("./paths");

const MIN_PRINT_USAGE_VERSION = [1, 1, 11];
let cachedExecutable = null;
let versionCache = null;

function parseVersion(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const left = Number(a && a[i]) || 0;
    const right = Number(b && b[i]) || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

function supportsPrintUsage(version) {
  return Array.isArray(version) && compareVersion(version, MIN_PRINT_USAGE_VERSION) >= 0;
}

function resolveAgyExecutable() {
  if (cachedExecutable && fs.existsSync(cachedExecutable)) return cachedExecutable;

  const candidates = [];
  if (process.env.AGY_BIN) candidates.push(process.env.AGY_BIN);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe"));
    candidates.push(path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.cmd"));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      cachedExecutable = candidate;
      return candidate;
    }
  }

  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(lookup, ["agy"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = String(output || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) {
      cachedExecutable = found;
      return found;
    }
  } catch {}

  return null;
}

function getAgyVersion(executable) {
  const exe = executable || resolveAgyExecutable();
  if (!exe) return null;
  const now = Date.now();
  if (versionCache && versionCache.exe === exe && now - versionCache.at < 5 * 60 * 1000) {
    return versionCache.version;
  }

  try {
    const output = execFileSync(exe, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = parseVersion(output);
    versionCache = { exe, at: now, version };
    return version;
  } catch {
    versionCache = { exe, at: now, version: null };
    return null;
  }
}

function clampPct(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 1e6) / 1e6;
}

function familyInfo(raw) {
  const family = String(raw || "").trim();
  const key = family.toLowerCase().replace(/\s+/g, " ");
  if (/^gemini(?: models?)?$/.test(key)) return { id: "gemini", label: "Gemini" };
  if (/^(?:claude(?: and|\/) gpt(?: models?)?|3p)$/.test(key)) return { id: "3p", label: "Claude/GPT" };
  const safe = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
  return { id: safe, label: family || "Antigravity" };
}

function periodInfo(raw) {
  const key = String(raw || "").trim().toLowerCase().replace(/_/g, "-");
  if (/\b(?:five[\s-]*hour|5[\s-]*hour|5h)\b/.test(key)) {
    return { id: "5h", label: "5시간 한도" };
  }
  if (/\b(?:weekly|week|7[\s-]*day)\b/.test(key)) {
    return { id: "weekly", label: "주간 한도" };
  }
  return null;
}

function sortedWindows(windows) {
  const order = { "gemini-5h": 0, "gemini-weekly": 1, "3p-5h": 2, "3p-weekly": 3 };
  return windows.sort((a, b) =>
    (order[a.id] ?? 100) - (order[b.id] ?? 100) ||
    String(a.label).localeCompare(String(b.label)) ||
    String(a.id).localeCompare(String(b.id))
  );
}

function resetTimestamp(value, seconds) {
  const direct = value == null || value === "" ? NaN : Date.parse(String(value));
  if (Number.isFinite(direct)) return direct;
  const delta = seconds == null || seconds === "" ? NaN : Number(seconds);
  return Number.isFinite(delta) && delta >= 0 ? Date.now() + delta * 1000 : null;
}

function modelLabelForBucket(bucketId, family) {
  if (family.id !== "gemini") return family.label;
  const id = String(bucketId || "").toLowerCase();
  if (id === "gemini-weekly" || id === "gemini-5h") return family.label;
  const match = id.match(/^gemini-(.+)-(?:weekly|5h)$/);
  if (!match) return family.label;
  const slug = match[1].replace(/-wtu$/, "");
  if (slug === "argon" || slug === "4-argon") return "Gemini 4 Argon";
  const display = slug.split("-").filter(Boolean)
    .map((part) => /^[0-9]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return display ? "Gemini " + display : family.label;
}

function parseUsageJson(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || "").trim());
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object" || payload.status === "ERROR") return [];
  const groups = (payload.command && payload.command.data && payload.command.data.groups) ||
    (payload.data && payload.data.groups) ||
    (payload.response && payload.response.groups) ||
    payload.groups;
  if (!Array.isArray(groups)) return [];

  const windows = [];
  const seen = new Map();
  for (const group of groups) {
    if (!group || !Array.isArray(group.buckets)) continue;
    const family = familyInfo(group.name || group.displayName || group.id);
    for (const bucket of group.buckets) {
      if (!bucket || bucket.disabled === true) continue;
      const bucketId = String(bucket.id || bucket.bucketId || "").trim().toLowerCase();
      const period = periodInfo(bucket.window || bucket.name || bucket.displayName || bucketId);
      if (!period) continue;
      const fraction = bucket.remaining_fraction ?? bucket.remainingFraction;
      if (fraction == null || fraction === "") continue;
      const numericFraction = Number(fraction);
      if (!Number.isFinite(numericFraction) || numericFraction < 0 || numericFraction > 1) continue;
      const remainingPct = clampPct(numericFraction * 100);
      if (remainingPct == null) continue;

      // Bucket IDs are the authoritative quota identities. An Argon weekly
      // bucket may share the "Gemini Models" group with gemini-weekly.
      let id = /^[a-z0-9-]+$/.test(bucketId) && bucketId
        ? bucketId
        : family.id + "-" + period.id;
      if (family.id !== "gemini" && family.id !== "3p" &&
          (id === "gemini-" + period.id || id === "3p-" + period.id)) {
        id = family.id + "-" + period.id;
      }
      if (seen.has(id)) {
        if (seen.get(id) === family.id) continue;
        id = family.id + "-" + id;
        if (seen.has(id)) continue;
      }
      seen.set(id, family.id);

      const label = modelLabelForBucket(bucketId, family);
      windows.push({
        id,
        label: label + " " + period.label,
        remainingPct,
        usedPct: 100 - remainingPct,
        resetAt: resetTimestamp(bucket.reset_time ?? bucket.resetTime,
          bucket.reset_in_seconds ?? bucket.resetInSeconds),
        source: "agy-print-usage",
      });
    }
  }
  return sortedWindows(windows);
}

function parseUsageTsv(text) {
  const windows = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split("\t").map((value) => value.trim());
    if (columns.length < 3) continue;
    const family = familyInfo(columns[0]);
    const period = periodInfo(columns[1]);
    if (!period) continue;
    const match = columns[2].match(/^(\d{1,3}(?:\.\d+)?)\s*%$/);
    const remainingPct = clampPct(match ? Number(match[1]) : null);
    if (remainingPct == null) continue;
    const id = family.id + "-" + period.id;
    if (seen.has(id)) continue;
    seen.add(id);
    windows.push({
      id,
      label: family.label + " " + period.label,
      remainingPct,
      usedPct: 100 - remainingPct,
      resetAt: resetTimestamp(columns[3]),
      source: "agy-print-usage",
    });
  }
  return sortedWindows(windows);
}

function parseUsageOutput(text) {
  const jsonWindows = parseUsageJson(text);
  return jsonWindows.length ? jsonWindows : parseUsageTsv(text);
}

function fetchLiveUsage() {
  const executable = resolveAgyExecutable();
  if (!executable) return Promise.resolve({ ok: false, reason: "cli-missing" });

  const version = getAgyVersion(executable);
  if (!version) return Promise.resolve({ ok: false, reason: "version-unknown" });
  if (!supportsPrintUsage(version)) {
    return Promise.resolve({
      ok: false,
      reason: "cli-too-old",
      version,
      hint: "agy 1.1.11 이상으로 업데이트하면 위젯이 quota를 자동 갱신합니다.",
    });
  }

  return new Promise((resolve) => {
    execFile(executable, ["-p", "/usage", "--output-format", "json"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 25000,
      maxBuffer: 256 * 1024,
      cwd: home(),
      env: process.env,
    }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, reason: "usage-command-failed", version });
        return;
      }
      const windows = parseUsageOutput(stdout);
      if (!windows.length) {
        resolve({ ok: false, reason: "usage-empty", version });
        return;
      }
      resolve({
        ok: true,
        version,
        windows,
        observedAt: Date.now(),
        source: "agy-print-usage",
      });
    });
  });
}

module.exports = {
  MIN_PRINT_USAGE_VERSION,
  parseVersion,
  compareVersion,
  supportsPrintUsage,
  resolveAgyExecutable,
  getAgyVersion,
  parseUsageTsv,
  parseUsageJson,
  parseUsageOutput,
  fetchLiveUsage,
};
