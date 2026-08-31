const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tokenWidget", {
  onUsage: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("usage", listener);
    return () => ipcRenderer.removeListener("usage", listener);
  },
  refresh: () => ipcRenderer.invoke("refresh"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (patch) => ipcRenderer.invoke("save-settings", patch),
  hide: () => ipcRenderer.invoke("hide"),
  quit: () => ipcRenderer.invoke("quit"),
  resize: (height) => ipcRenderer.invoke("resize", height),
});
