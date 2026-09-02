const { contextBridge } = require("electron");

const settings = {
  alwaysOnTop: false,
  compact: false,
  denseLayout: false,
  tokenAreaMaxHeight: 0,
  edgeDockEnabled: false,
  edgeDockSide: "top",
  openAtLogin: false,
  hideMissing: true,
  visualization: "ring",
  opacity: 0.94,
  refreshSeconds: 60,
  githubToken: "",
  cursorCookie: "",
};

contextBridge.exposeInMainWorld("tokenWidget", {
  refresh: async () => {},
  hide: async () => {},
  quit: async () => {},
  resize: async (height) => ({ requestedHeight: height, height, constrained: false }),
  getSettings: async () => ({ ...settings }),
  saveSettings: async (patch = {}) => Object.assign(settings, patch),
  onUsage: (callback) => {
    setTimeout(() => callback({ fetchedAt: Date.now(), providers: [], settings: { ...settings } }), 0);
  },
});
