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
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function familyInfo(raw) {
  const family = String(raw || "").trim();
  const key = family.toLowerCase();
  if (key.includes("gemini")) return { id: "gemini", label: "Gemini" };
  if (key.includes("claude") || key.includes("gpt")) return { id: "3p", label: "Claude/GPT" };
  const safe = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
  return { id: safe, label: family || "Antigravity" };
}

function periodInfo(raw) {
  const metric = String(raw || "").trim();
  const key = metric.toLowerCase();
  if (key.includes("five hour") || key.includes("5 hour") || key.includes("5h")) {
    return { id: "5h", label: "5시간 한도" };
  }
  if (key.includes("weekly") || key.includes("week")) {
    return { id: "weekly", label: "주간 한도" };
  }
  return null;
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

    const percentMatch = columns[2].match(/-?\d+(?:\.\d+)?/);
    const remainingPct = clampPct(percentMatch ? Number(percentMatch[0]) : NaN);
    if (remainingPct == null) continue;

    const id = `${family.id}-${period.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const parsedReset = columns[3] ? Date.parse(columns[3]) : NaN;
    windows.push({
      id,
      label: `${family.label} ${period.label}`,
      remainingPct,
      usedPct: 100 - remainingPct,
      resetAt: Number.isFinite(parsedReset) ? parsedReset : null,
      source: "agy-print-usage",
    });
  }

  const order = { "gemini-5h": 0, "gemini-weekly": 1, "3p-5h": 2, "3p-weekly": 3 };
  return windows.sort((a, b) => (order[a.id] ?? 100) - (order[b.id] ?? 100));
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
    execFile(executable, ["-p", "/usage"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 256 * 1024,
      cwd: home(),
      env: process.env,
    }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, reason: "usage-command-failed", version });
        return;
      }
      const windows = parseUsageTsv(stdout);
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
  fetchLiveUsage,
};
