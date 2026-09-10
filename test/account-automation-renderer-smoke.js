const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 760,
    height: 780,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer-layout-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    await win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
    await wait(600);

    const state = await win.webContents.executeJavaScript(`(() => ({
      cursorAdd: !!document.querySelector('[data-complete-account-add="cursor"]'),
      copilotAdd: !!document.querySelector('[data-complete-account-add="copilot"]'),
      antigravityAdd: !!document.querySelector('[data-complete-account-add="antigravity"]'),
      routingProviders: [...document.querySelectorAll('#smartRoutingGroup [data-route-provider]')].map((el) => el.dataset.routeProvider),
      codexProfileReset: !!document.querySelector('[data-codex-profile-reset="codex-profile-2"]'),
      antigravityHelperInstall: !!document.querySelector('[data-install-antigravity-manager]'),
    }))()`);
    assert.strictEqual(state.cursorAdd, true);
    assert.strictEqual(state.copilotAdd, true);
    assert.strictEqual(state.antigravityAdd, true);
    assert.deepStrictEqual(state.routingProviders, ["codex", "claude", "grok", "cursor", "copilot", "antigravity"]);
    assert.strictEqual(state.codexProfileReset, true);
    assert.strictEqual(state.antigravityHelperInstall, false, "installed Antigravity account manager should not show an install action");

    const saved = await win.webContents.executeJavaScript(`(async () => {
      const cursor = document.querySelector('[data-route-enabled="cursor"]');
      cursor.checked = true;
      cursor.dispatchEvent(new Event('change', { bubbles: true }));
      const reset = document.querySelector('[data-codex-profile-reset="codex-profile-2"]');
      reset.checked = true;
      reset.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 240));
      const settings = await window.tokenWidget.getSettings();
      return {
        cursorRouting: settings.smartRouting && settings.smartRouting.cursor && settings.smartRouting.cursor.enabled,
        profileReset: Array.isArray(settings.codexAutoResetProfiles) && settings.codexAutoResetProfiles.includes('codex-profile-2'),
      };
    })()`);
    assert.strictEqual(saved.cursorRouting, true, "new Smart Routing providers must persist without being erased by legacy controls");
    assert.strictEqual(saved.profileReset, true, "per-profile Codex reset opt-in must persist from settings UI");

    const addMessage = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-complete-account-add="cursor"]').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return document.getElementById('connectionHubMessage')?.textContent || '';
    })()`);
    assert.ok(addMessage.includes("로그인 창"), "Cursor +account must use the common managed-account login flow");

    console.log("complete account automation renderer smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
