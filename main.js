const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { loadSettings, saveSettings, resetSettings } = require("./lib/settings");
require("./lib/openrouter-main-integration");
require("./lib/api-providers-main-integration");
const { fetchAll } = require("./lib/usage");
const { applyAlwaysOnTop: setWindowAlwaysOnTop } = require("./lib/window-behavior");
const {
  pointInRect,
  expandRect,
  maxWidgetHeight,
  clampNormalBounds,
  getDockGeometry,
  interpolateBounds,
} = require("./lib/edge-dock");

app.commandLine.appendSwitch("js-flags", "--experimental-sqlite");
app.setAppUserModelId("com.tokenwidget.desktop");

const EDGE_POLL_MS = 50;
const EDGE_HIDE_DELAY_MS = 700;
const EDGE_REVEAL_GRACE_MS = 900;
const EDGE_SIDE_CHANGE_GRACE_MS = 3500;
const EDGE_STARTUP_GRACE_MS = 5000;
const EDGE_SHOW_MS = 180;
const EDGE_HIDE_MS = 160;

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
    showWidget({ focus: true });
  });
}

let win = null;
let tray = null;
let refreshTimer = null;
let fetching = false;
let alwaysOnTopRetry = null;
let edgePollTimer = null;
let edgeAnimationTimer = null;
let edgeState = "shown";
let edgeGeometry = null;
let edgeDisplayId = null;
let edgeOutsideSince = 0;
let edgeGraceUntil = 0;
let edgeConfigRevision = 0;
const cache = new Map();

function iconPath() {
  return path.join(__dirname, "assets", "icon.jpg");
}

function applyAlwaysOnTop(enabled) {
  if (!win || win.isDestroyed()) return;
  const desired = !!enabled;
  const applied = setWindowAlwaysOnTop(win, desired);

  if (alwaysOnTopRetry) clearTimeout(alwaysOnTopRetry);
  if (!applied) {
    alwaysOnTopRetry = setTimeout(() => {
      alwaysOnTopRetry = null;
      if (!win || win.isDestroyed()) return;
      setWindowAlwaysOnTop(win, desired);
    }, 50);
  }
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

function displayById(id) {
  if (id == null) return null;
  return screen.getAllDisplays().find((display) => String(display.id) === String(id)) || null;
}

function displayForNormalWindow() {
  if (!win || win.isDestroyed()) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds()) || screen.getPrimaryDisplay();
}

function safeInitialBounds(settings, width, height) {
  const hasPosition = !!(
    settings.position &&
    Number.isFinite(settings.position.x) &&
    Number.isFinite(settings.position.y)
  );
  const display = hasPosition
    ? screen.getDisplayNearestPoint({ x: settings.position.x, y: settings.position.y })
    : screen.getPrimaryDisplay();
  const work = display.workArea;
  const desired = hasPosition
    ? { x: settings.position.x, y: settings.position.y, width, height }
    : {
        x: work.x + work.width - width - 16,
        y: work.y + 16,
        width,
        height,
      };
  return clampNormalBounds(desired, work, 8);
}

function defaultVisibleBounds() {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const current = win && !win.isDestroyed() ? win.getBounds() : { width: 332, height: 420 };
  const width = Math.max(1, current.width || 332);
  const height = Math.min(
    Math.max(160, current.height || 420),
    maxWidgetHeight(work, 10),
  );
  return clampNormalBounds({
    x: work.x + work.width - width - 16,
    y: work.y + 16,
    width,
    height,
  }, work, 8);
}

function resolveDockDisplay(settings = loadSettings()) {
  const remembered = displayById(edgeDisplayId);
  if (remembered) return remembered;

  let display = null;
  if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) {
    display = screen.getDisplayNearestPoint({ x: settings.position.x, y: settings.position.y });
  }
  if (!display && win && !win.isDestroyed()) display = screen.getDisplayMatching(win.getBounds());
  if (!display) display = screen.getPrimaryDisplay();
  edgeDisplayId = display.id;
  return display;
}

function stableDockPositionHint(settings = loadSettings()) {
  if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) {
    return { x: settings.position.x, y: settings.position.y };
  }
  if (edgeGeometry && edgeGeometry.shown) {
    return { x: edgeGeometry.shown.x, y: edgeGeometry.shown.y };
  }
  if (!win || win.isDestroyed()) return null;
  const display = resolveDockDisplay(settings);
  const safe = clampNormalBounds(win.getBounds(), display.workArea, 6);
  return { x: safe.x, y: safe.y };
}

function calculateEdgeGeometry(settings = loadSettings(), positionOverride = null) {
  if (!win || win.isDestroyed()) return null;
  const display = resolveDockDisplay(settings);
  const bounds = win.getBounds();
  const positionHint = positionOverride || settings.position || { x: bounds.x, y: bounds.y };
  return getDockGeometry(
    display,
    { width: bounds.width, height: bounds.height },
    settings.edgeDockSide,
    positionHint,
    { margin: 6, peek: 3, triggerThickness: 10, triggerPadding: 8 },
  );
}

function cancelEdgeAnimation() {
  if (!edgeAnimationTimer) return;
  clearInterval(edgeAnimationTimer);
  edgeAnimationTimer = null;
}

function setBoundsImmediately(bounds) {
  if (!win || win.isDestroyed() || !bounds) return;
  win.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }, false);
}

function setPositionImmediately(target) {
  if (!win || win.isDestroyed() || !target) return;
  win.setPosition(Math.round(target.x), Math.round(target.y), false);
}

function animateEdgeTo(target, nextState, duration, focusAtEnd = false) {
  if (!win || win.isDestroyed() || !target) return;
  cancelEdgeAnimation();
  const from = win.getBounds();
  const to = { ...from, x: target.x, y: target.y };
  const started = Date.now();
  const total = Math.max(1, duration);

  edgeAnimationTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelEdgeAnimation();
      return;
    }
    const progress = Math.min(1, (Date.now() - started) / total);
    setPositionImmediately(interpolateBounds(from, to, progress));
    if (progress >= 1) {
      cancelEdgeAnimation();
      edgeState = nextState;
      if (focusAtEnd && win && !win.isDestroyed()) win.focus();
    }
  }, 16);
}

function revealEdgeDock(focus = false) {
  const settings = loadSettings();
  if (!settings.edgeDockEnabled || !win || win.isDestroyed()) return;
  edgeGeometry = calculateEdgeGeometry(settings);
  if (!edgeGeometry) return;

  if (!win.isVisible()) {
    if (focus) win.show();
    else win.showInactive();
  }
  applyAlwaysOnTop(settings.alwaysOnTop);
  edgeOutsideSince = 0;
  edgeGraceUntil = Date.now() + EDGE_REVEAL_GRACE_MS;
  edgeState = "showing";
  animateEdgeTo(edgeGeometry.shown, "shown", EDGE_SHOW_MS, focus);
}

function hideEdgeDock(immediate = false) {
  const settings = loadSettings();
  if (!settings.edgeDockEnabled || !win || win.isDestroyed()) return;
  edgeGeometry = calculateEdgeGeometry(settings);
  if (!edgeGeometry) return;

  edgeOutsideSince = 0;
  if (immediate) {
    cancelEdgeAnimation();
    setPositionImmediately(edgeGeometry.hidden);
    edgeState = "hidden";
    return;
  }
  edgeState = "hiding";
  animateEdgeTo(edgeGeometry.hidden, "hidden", EDGE_HIDE_MS, false);
}

function pollEdgeDock() {
  const settings = loadSettings();
  if (!settings.edgeDockEnabled || !win || win.isDestroyed()) return;

  edgeGeometry = calculateEdgeGeometry(settings);
  if (!edgeGeometry) return;
  const cursor = screen.getCursorScreenPoint();
  const inTrigger = pointInRect(cursor, edgeGeometry.trigger);
  const currentPanelBounds = expandRect(win.getBounds(), 6);
  const inPanel = pointInRect(cursor, currentPanelBounds);
  const now = Date.now();

  if ((edgeState === "hidden" || edgeState === "hiding") && inTrigger) {
    revealEdgeDock(false);
    return;
  }

  if (edgeState === "showing") {
    edgeOutsideSince = 0;
    return;
  }

  if (edgeState !== "shown") return;

  if (inPanel || inTrigger || now < edgeGraceUntil) {
    edgeOutsideSince = 0;
    return;
  }

  if (!edgeOutsideSince) edgeOutsideSince = now;
  if (now - edgeOutsideSince >= EDGE_HIDE_DELAY_MS) hideEdgeDock(false);
}

function startEdgePolling() {
  if (edgePollTimer) clearInterval(edgePollTimer);
  edgePollTimer = setInterval(pollEdgeDock, EDGE_POLL_MS);
}

function stopEdgePolling() {
  if (edgePollTimer) clearInterval(edgePollTimer);
  edgePollTimer = null;
  edgeOutsideSince = 0;
  edgeGraceUntil = 0;
}

function configureEdgeDock(settings = loadSettings(), options = {}) {
  if (!win || win.isDestroyed()) return;
  const revision = ++edgeConfigRevision;
  const sideChanged = options.sideChanged === true;
  const startupVisible = options.startupVisible === true;
  cancelEdgeAnimation();

  if (!settings.edgeDockEnabled) {
    stopEdgePolling();
    const restore = edgeGeometry && edgeGeometry.shown
      ? edgeGeometry.shown
      : clampNormalBounds(win.getBounds(), displayForNormalWindow().workArea, 8);
    edgeGeometry = null;
    edgeDisplayId = null;
    edgeState = "shown";
    setPositionImmediately(restore);
    saveSettings({ position: { x: restore.x, y: restore.y } });
    return;
  }

  if (edgeDisplayId == null) {
    const display = screen.getDisplayMatching(win.getBounds()) || resolveDockDisplay(settings);
    edgeDisplayId = display.id;
  }

  const positionHint = sideChanged ? stableDockPositionHint(settings) : null;
  edgeGeometry = calculateEdgeGeometry(settings, positionHint);
  startEdgePolling();

  if (!win.isVisible()) win.showInactive();
  if (options.initialHidden) {
    setPositionImmediately(edgeGeometry.hidden);
    edgeState = "hidden";
    return;
  }

  // Edge mode is a native screen-position feature only. Never change the
  // BrowserWindow content size here; renderer geometry must remain identical
  // before and after enabling/disabling the dock.
  setPositionImmediately(edgeGeometry.shown);
  edgeState = "shown";
  edgeOutsideSince = 0;
  edgeGraceUntil = Date.now() + (
    sideChanged
      ? EDGE_SIDE_CHANGE_GRACE_MS
      : startupVisible
        ? EDGE_STARTUP_GRACE_MS
        : 1400
  );

  if (sideChanged || startupVisible) {
    win.show();
    win.focus();
  }

  if (sideChanged) {
    setImmediate(() => {
      if (revision !== edgeConfigRevision || !win || win.isDestroyed()) return;
      const current = loadSettings();
      if (!current.edgeDockEnabled || current.edgeDockSide !== settings.edgeDockSide) return;
      edgeGeometry = calculateEdgeGeometry(current, positionHint);
      if (!edgeGeometry) return;
      cancelEdgeAnimation();
      setPositionImmediately(edgeGeometry.shown);
      edgeState = "shown";
      edgeOutsideSince = 0;
      edgeGraceUntil = Date.now() + EDGE_SIDE_CHANGE_GRACE_MS;
    });
  }
}

function showWidget({ focus = true } = {}) {
  if (!win || win.isDestroyed()) return;
  const settings = loadSettings();
  applyAlwaysOnTop(settings.alwaysOnTop);

  if (settings.edgeDockEnabled) {
    revealEdgeDock(focus);
    return;
  }

  const display = screen.getDisplayMatching(win.getBounds()) || screen.getPrimaryDisplay();
  setBoundsImmediately(clampNormalBounds(win.getBounds(), display.workArea, 8));
  win.show();
  if (focus) win.focus();
  setImmediate(() => applyAlwaysOnTop(settings.alwaysOnTop));
}

function createWindow() {
  const settings = loadSettings();
  const primaryWork = screen.getPrimaryDisplay().workArea;
  const width = 332;
  const height = Math.min(420, maxWidgetHeight(primaryWork, 10));
  const initial = safeInitialBounds(settings, width, height);

  win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !!settings.alwaysOnTop,
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
    if (settings.edgeDockEnabled) {
      configureEdgeDock(settings, { initialHidden: false, startupVisible: true });
    } else {
      showWidget({ focus: true });
    }
    refreshUsage(true);
  });

  win.on("show", () => {
    applyAlwaysOnTop(loadSettings().alwaysOnTop);
  });

  win.on("moved", () => {
    if (!win || win.isDestroyed()) return;
    const current = loadSettings();
    if (current.edgeDockEnabled || edgeAnimationTimer) return;
    const [x, y] = win.getPosition();
    saveSettings({ position: { x, y } });
  });

  win.on("close", (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    if (loadSettings().edgeDockEnabled) hideEdgeDock(true);
    else win.hide();
  });
}

async function resetUserSettingsFromTray() {
  const options = {
    type: "warning",
    title: "설정값 초기화",
    message: "위젯 설정을 기본값으로 초기화할까요?",
    detail: "위치, 엣지 패널, 최대 높이, 표시 방식, 투명도, 시작프로그램 설정을 초기화합니다. GitHub/Cursor 인증값은 유지됩니다.",
    buttons: ["초기화", "취소"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const result = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) return;

  const next = resetSettings({ preserveCredentials: true });
  stopEdgePolling();
  cancelEdgeAnimation();
  edgeConfigRevision += 1;
  edgeGeometry = null;
  edgeDisplayId = null;
  edgeState = "shown";
  edgeOutsideSince = 0;
  edgeGraceUntil = 0;

  applyOpenAtLogin(false);
  scheduleRefresh();

  if (!win || win.isDestroyed()) return;
  win.setOpacity(next.opacity);
  setBoundsImmediately(defaultVisibleBounds());
  applyAlwaysOnTop(next.alwaysOnTop);
  win.show();
  win.focus();

  win.webContents.once("did-finish-load", () => refreshUsage(true));
  win.webContents.reloadIgnoringCache();
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("AI 토큰 위젯");
  const menu = Menu.buildFromTemplate([
    { label: "위젯 보기", click: () => showWidget({ focus: true }) },
    { label: "새로고침", click: () => refreshUsage(true) },
    { type: "separator" },
    { label: "설정값 초기화", click: () => resetUserSettingsFromTray() },
    { type: "separator" },
    { label: "종료", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!win) return;
    const settings = loadSettings();
    if (settings.edgeDockEnabled) {
      if (edgeState === "shown" || edgeState === "showing") hideEdgeDock(false);
      else revealEdgeDock(true);
      return;
    }
    if (win.isVisible()) win.hide();
    else showWidget({ focus: true });
  });
}

function mergeCache(providers) {
  return providers.map((provider) => {
    const prev = cache.get(provider.id);
    if (provider.status === "ok") {
      cache.set(provider.id, provider);
      return provider;
    }
    if (prev && prev.status === "ok" && provider.status === "error") {
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
  const prev = loadSettings();
  const next = saveSettings(patch || {});
  if (Object.prototype.hasOwnProperty.call(patch || {}, "alwaysOnTop")) applyAlwaysOnTop(next.alwaysOnTop);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "opacity") && win) win.setOpacity(next.opacity);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "openAtLogin")) applyOpenAtLogin(!!next.openAtLogin);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "refreshSeconds")) scheduleRefresh();
  if (
    Object.prototype.hasOwnProperty.call(patch || {}, "edgeDockEnabled") ||
    Object.prototype.hasOwnProperty.call(patch || {}, "edgeDockSide")
  ) {
    if (!prev.edgeDockEnabled && next.edgeDockEnabled) edgeDisplayId = null;
    const sideChanged = next.edgeDockEnabled && prev.edgeDockSide !== next.edgeDockSide;
    configureEdgeDock(next, { initialHidden: false, sideChanged });
  }
  return next;
});
ipcMain.handle("hide", () => {
  if (!win) return;
  if (loadSettings().edgeDockEnabled) hideEdgeDock(true);
  else win.hide();
});
ipcMain.handle("quit", () => {
  app.isQuitting = true;
  app.quit();
});
ipcMain.handle("resize", (_event, height) => {
  if (!win || win.isDestroyed()) return null;
  const requested = Number(height);
  if (!Number.isFinite(requested) || requested <= 0) return null;

  const settings = loadSettings();
  const display = settings.edgeDockEnabled ? resolveDockDisplay(settings) : displayForNormalWindow();
  const maxHeight = maxWidgetHeight(display.workArea, 10);
  const nextHeight = Math.min(maxHeight, Math.max(160, Math.round(requested)));
  const current = win.getBounds();
  const resized = { ...current, height: nextHeight };

  if (settings.edgeDockEnabled) {
    // Content-driven height changes are allowed, but the subsequent edge snap
    // changes position only. This prevents dock toggles from becoming implicit
    // layout resizes while still supporting real card/settings height changes.
    setBoundsImmediately(resized);
    edgeGeometry = calculateEdgeGeometry(settings, stableDockPositionHint(settings));
    if (edgeGeometry) {
      const hidden = edgeState === "hidden" || edgeState === "hiding";
      const target = hidden ? edgeGeometry.hidden : edgeGeometry.shown;
      cancelEdgeAnimation();
      setPositionImmediately(target);
      edgeState = hidden ? "hidden" : "shown";
    }
  } else {
    const fitted = clampNormalBounds(resized, display.workArea, 8);
    setBoundsImmediately(fitted);
  }

  return {
    requestedHeight: Math.round(requested),
    height: nextHeight,
    maxHeight,
    constrained: requested > maxHeight,
  };
});

function refreshForDisplayChange() {
  if (!win || win.isDestroyed()) return;
  const settings = loadSettings();
  if (settings.edgeDockEnabled) {
    if (!displayById(edgeDisplayId)) edgeDisplayId = null;
    edgeGeometry = calculateEdgeGeometry(settings, stableDockPositionHint(settings));
    if (!edgeGeometry) return;
    const target = edgeState === "hidden" || edgeState === "hiding"
      ? edgeGeometry.hidden
      : edgeGeometry.shown;
    setPositionImmediately(target);
    return;
  }
  const display = displayForNormalWindow();
  setBoundsImmediately(clampNormalBounds(win.getBounds(), display.workArea, 8));
}

app.whenReady().then(() => {
  if (!gotTheLock) return;
  const settings = loadSettings();
  applyOpenAtLogin(!!settings.openAtLogin);
  createWindow();
  createTray();
  scheduleRefresh();

  screen.on("display-metrics-changed", refreshForDisplayChange);
  screen.on("display-added", refreshForDisplayChange);
  screen.on("display-removed", refreshForDisplayChange);
});

app.on("before-quit", () => {
  stopEdgePolling();
  cancelEdgeAnimation();
  if (alwaysOnTopRetry) clearTimeout(alwaysOnTopRetry);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
