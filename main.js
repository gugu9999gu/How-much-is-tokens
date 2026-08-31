const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { loadSettings, saveSettings } = require("./lib/settings");
const { fetchAll } = require("./lib/usage");

app.commandLine.appendSwitch("js-flags", "--experimental-sqlite");
app.setAppUserModelId("com.tokenwidget.desktop");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: "info",
      title: "토큰 위젯",
      message: "이미 실행 중입니다.",
      buttons: ["확인"],
    });
    app.exit(0);
  });
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    applyAlwaysOnTop(loadSettings().alwaysOnTop);
  });
}

let win = null;
let tray = null;
let refreshTimer = null;
let fetching = false;
const cache = new Map();

function iconPath() {
  return path.join(__dirname, "assets", "icon.jpg");
}

function applyAlwaysOnTop(enabled) {
  if (!win) return;
  win.setAlwaysOnTop(!!enabled, enabled ? "screen-saver" : "normal");
  if (enabled) win.moveTop();
}

function startupPath() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && fs.existsSync(portable)) return portable;
  return process.execPath;
}

function applyOpenAtLogin(enabled) {
  const exe = startupPath();
  app.setLoginItemSettings({ openAtLogin: false });
  app.setLoginItemSettings({ openAtLogin: false, path: exe });
  if (enabled) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: exe,
      args: [],
    });
  }
}

function createWindow() {
  const settings = loadSettings();
  const display = screen.getPrimaryDisplay().workArea;
  const width = 332;
  const height = 420;
  const startX = settings.position?.x ?? display.x + display.width - width - 16;
  const startY = settings.position?.y ?? display.y + 16;

  win = new BrowserWindow({
    width,
    height,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setHasShadow(false);
  applyAlwaysOnTop(settings.alwaysOnTop);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(settings.opacity ?? 0.94);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.once("ready-to-show", () => {
    win.show();
    refreshUsage(true);
  });

  win.on("moved", () => {
    if (!win) return;
    const [x, y] = win.getPosition();
    saveSettings({ position: { x, y } });
  });

  win.on("close", (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    win.hide();
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("AI 토큰 위젯");
  const menu = Menu.buildFromTemplate([
    { label: "위젯 보기", click: () => { win?.show(); win?.focus(); } },
    { label: "새로고침", click: () => refreshUsage(true) },
    { type: "separator" },
    { label: "종료", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
}

function mergeCache(providers) {
  return providers.map((provider) => {
    const prev = cache.get(provider.id);
    if (provider.status === "ok") {
      cache.set(provider.id, provider);
      return provider;
    }
    if (prev && prev.status === "ok" && (provider.status === "error")) {
      return { ...prev, stale: true, error: provider.error };
    }
    return provider;
  });
}

async function refreshUsage(force) {
  if (fetching) return;
  fetching = true;
  try {
    const settings = loadSettings();
    const result = await fetchAll(settings);
    result.providers = mergeCache(result.providers);
    result.forced = !!force;
    win?.webContents.send("usage", { ...result, settings });
  } catch (err) {
    win?.webContents.send("usage", {
      fetchedAt: Date.now(),
      providers: [],
      error: err.message,
      settings: loadSettings(),
    });
  } finally {
    fetching = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const seconds = Math.max(20, Number(loadSettings().refreshSeconds) || 60);
  refreshTimer = setInterval(() => refreshUsage(false), seconds * 1000);
}

ipcMain.handle("refresh", async () => {
  await refreshUsage(true);
});
ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_event, patch) => {
  const next = saveSettings(patch || {});
  if (Object.prototype.hasOwnProperty.call(patch || {}, "alwaysOnTop")) applyAlwaysOnTop(next.alwaysOnTop);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "opacity") && win) win.setOpacity(next.opacity);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "openAtLogin")) {
    applyOpenAtLogin(!!next.openAtLogin);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "refreshSeconds")) scheduleRefresh();
  return next;
});
ipcMain.handle("hide", () => win?.hide());
ipcMain.handle("quit", () => {
  app.isQuitting = true;
  app.quit();
});
ipcMain.handle("resize", (_event, height) => {
  if (!win || !height) return;
  const next = Math.max(160, Math.min(720, Math.round(height)));
  const bounds = win.getBounds();
  if (Math.abs(bounds.height - next) > 4) win.setContentSize(bounds.width, next);
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  const settings = loadSettings();
  applyOpenAtLogin(!!settings.openAtLogin);
  createWindow();
  createTray();
  scheduleRefresh();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
