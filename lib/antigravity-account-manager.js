const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");
const { resolveCommand, interactiveLoginCommand } = require("./credential-login");
const { stableAccountKey } = require("./account-identity");
const { parseTime } = require("./time");

const AGM_REPOSITORY = "github.com/shyim/agm@latest";
const AGM_TIMEOUT_MS = 20_000;

function goInstalledAgmPath(options = {}) {
  const go = options.goExecutable || resolveCommand(["go"], options);
  if (!go) return null;
  const execImpl = options.execFileSyncImpl || execFileSync;
  try {
    let bin = String(execImpl(go, ["env", "GOBIN"], {
      encoding: "utf8", windowsHide: true, timeout: 3_000, stdio: ["ignore", "pipe", "ignore"], env: options.env || process.env,
    }) || "").trim();
    if (!bin) {
      const gopath = String(execImpl(go, ["env", "GOPATH"], {
        encoding: "utf8", windowsHide: true, timeout: 3_000, stdio: ["ignore", "pipe", "ignore"], env: options.env || process.env,
      }) || "").trim().split(path.delimiter)[0];
      if (gopath) bin = path.join(gopath, "bin");
    }
    if (!bin) return null;
    const executable = path.join(bin, process.platform === "win32" ? "agm.exe" : "agm");
    return fs.existsSync(executable) ? executable : null;
  } catch {
    return null;
  }
}

function resolvedAgm(options = {}) {
  return options.executable || resolveCommand(["agm"], options) || goInstalledAgmPath(options);
}

function runFile(command, args, options = {}) {
  return new Promise((resolve) => {
    const execImpl = options.execFileImpl || execFile;
    execImpl(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: options.timeout || AGM_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: options.env || process.env,
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error: error ? (error.message || String(error)) : null });
    });
  });
}

function pct(value) {
  const match = String(value || "").match(/^(\d{1,3})%$/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

function parseAccountList(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^EMAIL\s+/i.test(trimmed) || /^-+$/.test(trimmed) || /^No accounts/i.test(trimmed)) continue;
    const cols = trimmed.split(/\s+/);
    if (cols.length < 4 || !cols[0].includes("@")) continue;
    const email = cols.shift();
    let status = "";
    if (cols.length >= 4) status = cols.shift();
    const gemPro = pct(cols[0]);
    const gemFlash = pct(cols[1]);
    const claude = pct(cols[2]);
    rows.push({
      email,
      status,
      active: /(^|,)cli(,|$)/i.test(status) || /(^|,)active(,|$)/i.test(status),
      tokenExpired: /token-exp/i.test(status),
      summary: { gemPro, gemFlash, claude },
    });
  }
  return rows;
}

function parseAccountInfo(output) {
  const windows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(GOOGLE|ANTHROPIC|OTHER)\s+(.+?)\s+(\d{1,3})%\s+(.+)$/i);
    if (!match) continue;
    windows.push({
      id: `agm-${windows.length + 1}`,
      label: match[2].trim(),
      remainingPct: Math.max(0, Math.min(100, Number(match[3]))),
      usedPct: 100 - Math.max(0, Math.min(100, Number(match[3]))),
      resetAt: parseTime(match[4].trim()),
      source: "agm",
    });
  }
  return windows;
}

function fallbackWindows(account) {
  const rows = [
    ["gemini-pro", "Gemini Pro", account.summary && account.summary.gemPro],
    ["gemini-flash", "Gemini Flash", account.summary && account.summary.gemFlash],
    ["claude", "Claude", account.summary && account.summary.claude],
  ];
  return rows.filter((row) => Number.isFinite(row[2])).map(([id, label, remainingPct]) => ({ id, label, remainingPct, usedPct: 100 - remainingPct, resetAt: null, source: "agm-list" }));
}

function profileIdForEmail(email) {
  return `agm-${crypto.createHash("sha256").update(String(email || "").toLowerCase()).digest("hex").slice(0, 12)}`;
}

async function listManagedUsageRows(options = {}) {
  const executable = resolvedAgm(options);
  if (!executable) return null;
  const listed = await runFile(executable, ["list"], options);
  if (!listed.ok) return null;
  const accounts = parseAccountList(listed.stdout);
  return Promise.all(accounts.map(async (account, index) => {
    const info = await runFile(executable, ["info", account.email], { ...options, timeout: 8_000 });
    const detailed = info.ok ? parseAccountInfo(info.stdout) : [];
    const windows = detailed.length ? detailed : fallbackWindows(account);
    const remainingValues = windows.map((row) => Number(row.remainingPct)).filter(Number.isFinite);
    const remainingPct = remainingValues.length ? Math.min(...remainingValues) : null;
    const resets = windows.map((row) => Number(row.resetAt)).filter((value) => Number.isFinite(value) && value > 0);
    const profileId = profileIdForEmail(account.email);
    return {
      id: `antigravity:${profileId}`,
      providerId: "antigravity",
      profileId,
      externalAccountRef: account.email,
      accountKey: stableAccountKey("antigravity", account.email),
      accountEmail: account.email,
      accountLabel: account.active ? "기본 계정" : `Antigravity ${index + 1}`,
      accountOrder: index,
      instanceKey: `antigravity:${profileId}`,
      name: "Antigravity",
      brand: "#4285f4",
      status: account.tokenExpired ? "login" : "ok",
      remainingPct,
      routingRemainingPct: remainingPct,
      usedPct: Number.isFinite(remainingPct) ? 100 - remainingPct : null,
      resetAt: resets.length ? Math.min(...resets) : null,
      windows,
      extras: [{ label: "계정 관리자", value: account.active ? "AGM · 현재 CLI" : "AGM" }],
      managedBy: "agm",
      routeManaged: true,
    };
  }));
}

async function managerStatus(options = {}) {
  const executable = resolvedAgm(options);
  const go = options.goExecutable || resolveCommand(["go"], options);
  if (!executable) return { installed: false, goAvailable: !!go, repository: AGM_REPOSITORY };
  const listed = await runFile(executable, ["list"], { ...options, timeout: 5_000 });
  return { installed: true, executable, goAvailable: !!go, ready: listed.ok, repository: AGM_REPOSITORY, error: listed.ok ? null : (listed.stderr.trim() || listed.error) };
}

async function installManager(options = {}) {
  const go = options.goExecutable || resolveCommand(["go"], options);
  if (!go) return { ok: false, reason: "go-not-found" };
  const result = await runFile(go, ["install", AGM_REPOSITORY], { ...options, timeout: 180_000 });
  if (!result.ok) return { ok: false, reason: "install-failed", error: result.stderr.trim() || result.error };
  const status = await managerStatus({ ...options, goExecutable: go });
  return status.installed ? { ok: true, status } : { ok: false, reason: "installed-binary-not-found" };
}

function launchLogin(options = {}) {
  const executable = resolvedAgm(options);
  if (!executable) return { ok: false, reason: "account-manager-required", goAvailable: !!resolveCommand(["go"], options) };
  if ((options.platform || process.platform) !== "win32") return { ok: false, reason: "unsupported-platform" };
  const comspec = options.comspec || process.env.ComSpec || "cmd.exe";
  const commandLine = interactiveLoginCommand(executable, ["login"], comspec);
  if (!commandLine) return { ok: false, reason: "invalid-command" };
  try {
    const child = (options.spawnImpl || spawn)(comspec, ["/d", "/s", "/c", commandLine], {
      env: process.env, cwd: options.cwd || process.cwd(), detached: true, windowsVerbatimArguments: true, windowsHide: false, stdio: "ignore",
    });
    if (child && typeof child.unref === "function") child.unref();
    return { ok: true, needsRefresh: true, accountLabel: "Antigravity 추가 계정", managedBy: "agm" };
  } catch (err) {
    return { ok: false, reason: "spawn-failed", error: err.message || String(err) };
  }
}

async function switchAccount(accountRef, options = {}) {
  const email = String(accountRef || "").trim();
  const executable = resolvedAgm(options);
  if (!executable) return { ok: false, reason: "account-manager-required" };
  if (!email || /[\r\n]/.test(email)) return { ok: false, reason: "invalid-account" };
  const result = await runFile(executable, ["switch", email, "--target", "agy"], options);
  return result.ok ? { ok: true, accountRef: email, output: result.stdout.trim() } : { ok: false, reason: "switch-failed", error: result.stderr.trim() || result.stdout.trim() || result.error };
}

async function removeAccount(accountRef, options = {}) {
  const email = String(accountRef || "").trim();
  const executable = resolvedAgm(options);
  if (!executable) return { ok: false, reason: "account-manager-required" };
  if (!email || /[\r\n]/.test(email)) return { ok: false, reason: "invalid-account" };
  const result = await runFile(executable, ["remove", email], options);
  return result.ok ? { ok: true, accountRef: email } : { ok: false, reason: "remove-failed", error: result.stderr.trim() || result.stdout.trim() || result.error };
}

module.exports = {
  AGM_REPOSITORY,
  goInstalledAgmPath,
  resolvedAgm,
  runFile,
  parseAccountList,
  parseAccountInfo,
  fallbackWindows,
  profileIdForEmail,
  listManagedUsageRows,
  managerStatus,
  installManager,
  launchLogin,
  switchAccount,
  removeAccount,
};
