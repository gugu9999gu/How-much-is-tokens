const { contextBridge } = require("electron");

const settings = {
  hideMissing: true,
  pinnedProviderCards: [],
  autoHeight: true,
  manualWindowSize: { width: 620 },
};

let payload = {
  fetchedAt: Date.now(),
  providers: [
    { id: "codex", providerId: "codex", name: "Codex", status: "ok", remainingPct: 75 },
    { id: "claude", providerId: "claude", name: "Claude", status: "ok", remainingPct: 60 },
  ],
  settings: { ...settings, manualWindowSize: { ...settings.manualWindowSize } },
};
const listeners = new Set();
let resizeStarted = false;

function cloneSettings() {
  return {
    ...settings,
    pinnedProviderCards: [...(settings.pinnedProviderCards || [])],
    manualWindowSize: settings.manualWindowSize ? { ...settings.manualWindowSize } : null,
  };
}

function currentPayload() {
  return { ...payload, settings: cloneSettings() };
}

contextBridge.exposeInMainWorld("tokenWidget", {
  getLastUsage: () => currentPayload(),
  getSettings: async () => cloneSettings(),
  saveSettings: async (patch = {}) => {
    Object.assign(settings, patch);
    if (Array.isArray(patch.pinnedProviderCards)) settings.pinnedProviderCards = [...patch.pinnedProviderCards];
    if (Object.prototype.hasOwnProperty.call(patch, "manualWindowSize")) {
      settings.manualWindowSize = patch.manualWindowSize ? { ...patch.manualWindowSize } : null;
    }
    payload = currentPayload();
    return cloneSettings();
  },
  manualWindowResize: async (request = {}) => {
    if (request.phase === "start") {
      resizeStarted = true;
      return { ok: true, phase: "start" };
    }
    if (request.phase === "end" && resizeStarted) {
      resizeStarted = false;
      settings.manualWindowSize = { width: 620, height: 480 };
      settings.autoHeight = false;
      payload = currentPayload();
      return { ok: true, phase: "end", settings: cloneSettings(), manualWindowSize: { ...settings.manualWindowSize } };
    }
    return { ok: false, reason: "resize-not-started" };
  },
  onUsage: (callback) => {
    listeners.add(callback);
    setTimeout(() => callback(currentPayload()), 0);
    return () => listeners.delete(callback);
  },
});

contextBridge.exposeInMainWorld("cardPinTest", {
  settings: () => cloneSettings(),
});
