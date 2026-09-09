const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { loadSettings, saveSettings } = require("./settings");
const {
  MIN_WIDTH,
  MIN_HEIGHT,
  validDirection,
  resizeLocks,
  computeResizeBounds,
  normalizeManualWindowSize,
} = require("./window-resize");

const resizeSessions = new Map();

function senderKey(event) {
  return event && event.sender ? event.sender.id : null;
}

function windowForEvent(event) {
  return event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
}

function displayWorkArea(win) {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

function applyPersistedManualSize(win) {
  if (!win || win.isDestroyed()) return null;
  const manual = normalizeManualWindowSize(loadSettings().manualWindowSize);
  if (!manual) return null;

  const current = win.getBounds();
  const work = displayWorkArea(win);
  const width = Math.min(manual.width || current.width, work.width);
  const height = Math.min(manual.height || current.height, work.height);
  const x = Math.min(Math.max(current.x, work.x), work.x + work.width - width);
  const y = Math.min(Math.max(current.y, work.y), work.y + work.height - height);
  const bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  win.setBounds(bounds, false);
  return bounds;
}

app.on("browser-window-created", (_event, win) => {
  try { win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT); } catch {}
  win.once("ready-to-show", () => applyPersistedManualSize(win));
});

ipcMain.handle("manual-window-resize", (event, payload = {}) => {
  const win = windowForEvent(event);
  if (!win || win.isDestroyed()) return { ok: false, reason: "window-missing" };

  const key = senderKey(event);
  const phase = String(payload.phase || "").toLowerCase();
  const x = Number(payload.x);
  const y = Number(payload.y);

  if (phase === "start") {
    const direction = validDirection(payload.direction);
    if (!direction || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, reason: "invalid-resize-start" };
    }
    resizeSessions.set(key, {
      direction,
      pointerX: x,
      pointerY: y,
      initialBounds: win.getBounds(),
      workArea: displayWorkArea(win),
    });
    return { ok: true, phase, bounds: win.getBounds() };
  }

  const session = resizeSessions.get(key);
  if (!session) return { ok: false, reason: "resize-not-started" };

  if ((phase === "move" || phase === "end" || phase === "cancel") && Number.isFinite(x) && Number.isFinite(y)) {
    const next = computeResizeBounds(
      session.initialBounds,
      session.direction,
      x - session.pointerX,
      y - session.pointerY,
      session.workArea,
      { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT },
    );
    if (next) win.setBounds(next, false);
  }

  if (phase === "move") return { ok: true, phase, bounds: win.getBounds() };
  if (phase !== "end" && phase !== "cancel") return { ok: false, reason: "invalid-resize-phase" };

  resizeSessions.delete(key);
  const bounds = win.getBounds();
  const locks = resizeLocks(session.direction);
  const previous = normalizeManualWindowSize(loadSettings().manualWindowSize) || {};
  const manualWindowSize = normalizeManualWindowSize({
    width: locks.width ? bounds.width : previous.width,
    height: locks.height ? bounds.height : previous.height,
  });
  const settings = saveSettings({
    manualWindowSize,
    position: { x: bounds.x, y: bounds.y },
  });
  return { ok: true, phase, bounds, manualWindowSize, settings };
});

module.exports = {
  applyPersistedManualSize,
};
