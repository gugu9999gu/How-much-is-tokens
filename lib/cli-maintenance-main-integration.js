const { ipcMain } = require("electron");
const { inspectAllCli, updateCli } = require("./cli-maintenance");

ipcMain.handle("get-cli-versions", (_event, options = {}) => inspectAllCli({
  force: options && options.force === true,
  checkLatest: options && options.checkLatest === false ? false : true,
}));

ipcMain.handle("update-cli", (_event, providerId) => updateCli(providerId));

module.exports = {};
