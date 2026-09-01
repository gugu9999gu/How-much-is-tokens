function applyAlwaysOnTop(window, enabled) {
  if (!window) return false;
  if (typeof window.isDestroyed === "function" && window.isDestroyed()) return false;

  const desired = !!enabled;
  if (desired) {
    window.setAlwaysOnTop(true, "screen-saver");
    if (typeof window.moveTop === "function") window.moveTop();
  } else {
    // Electron resets the level to normal when flag=false. Do not pass a
    // high z-order level while disabling; make the native state explicit.
    window.setAlwaysOnTop(false);
  }

  if (typeof window.isAlwaysOnTop !== "function") return true;
  return window.isAlwaysOnTop() === desired;
}

module.exports = { applyAlwaysOnTop };
