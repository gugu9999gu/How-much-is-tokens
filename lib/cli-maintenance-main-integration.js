const { ipcMain, BrowserWindow } = require("electron");
const { inspectAllCli, updateCli, maybeAutoUpdateCli } = require("./cli-maintenance");
const { loadSettings } = require("./settings");

let installed = false;

function sendCliVersions(statuses) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("cli-versions", statuses);
  }
}

async function broadcastUpdatedCliVersions() {
  const statuses = await inspectAllCli({ force: true, checkLatest: true });
  sendCliVersions(statuses);
  return statuses;
}

function queueCliAutoUpdate(statuses) {
  let settings;
  try {
    settings = loadSettings();
  } catch {
    return;
  }
  if (settings.cliAutoUpdate !== true) return;
  maybeAutoUpdateCli({ settings, statuses }).then(async (result) => {
    const updated = Array.isArray(result && result.results)
      && result.results.some((item) => item && item.ok === true && item.skipped !== true);
    if (!updated) return;
    await broadcastUpdatedCliVersions();
  }).catch(() => {});
}

function installCliMaintenanceIpc() {
  if (installed) return;
  installed = true;

  ipcMain.handle("get-cli-versions", async (_event, options = {}) => {
    const statuses = await inspectAllCli({
      force: options && options.force === true,
      checkLatest: options && options.checkLatest === false ? false : true,
    });
    queueCliAutoUpdate(statuses);
    return statuses;
  });

  ipcMain.handle("update-cli", (_event, providerId) => updateCli(providerId));

  ipcMain.handle("auto-update-cli", async () => {
    const settings = loadSettings();
    const result = await maybeAutoUpdateCli({ settings, force: true });
    const updated = Array.isArray(result && result.results)
      && result.results.some((item) => item && item.ok === true && item.skipped !== true);
    if (updated) {
      const statuses = await broadcastUpdatedCliVersions();
      return { ...result, statuses };
    }
    return result;
  });
}

installCliMaintenanceIpc();

module.exports = {
  installCliMaintenanceIpc,
  queueCliAutoUpdate,
  sendCliVersions,
};
