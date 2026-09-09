const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectMode(win, mode) {
  return win.webContents.executeJavaScript(`(async () => {
    const input = document.querySelector('input[name="resetDisplayMode"][value="${mode}"]');
    if (!input) return { missing: true };
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const settings = await window.tokenWidget.getSettings();
    return {
      missing: false,
      saved: settings.resetDisplayMode,
      checked: document.querySelector('input[name="resetDisplayMode"]:checked')?.value || '',
      resetText: document.querySelector('#list .sub')?.textContent || '',
    };
  })()`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
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
    await wait(320);

    const initial = await win.webContents.executeJavaScript(`(() => ({
      field: !!document.getElementById('resetDisplayModeField'),
      modes: [...document.querySelectorAll('input[name="resetDisplayMode"]')].map((input) => input.value),
      checked: document.querySelector('input[name="resetDisplayMode"]:checked')?.value || '',
      description: document.querySelector('#resetDisplayModeField .viz-head small')?.textContent || '',
    }))()`);
    assert.strictEqual(initial.field, true, "reset display mode setting must be installed in settings");
    assert.deepStrictEqual(initial.modes, ["auto", "relative", "absolute"]);
    assert.strictEqual(initial.checked, "auto", "legacy behavior must remain automatic by default");
    assert.ok(initial.description.includes("5초"), "automatic mode must explain the five-second rotation");

    const relative = await selectMode(win, "relative");
    assert.strictEqual(relative.missing, false);
    assert.strictEqual(relative.saved, "relative", "remaining-time mode must persist");
    assert.strictEqual(relative.checked, "relative");
    assert.ok(relative.resetText.includes("후 리셋"), `relative mode should show remaining time (${relative.resetText})`);
    assert.ok(!relative.resetText.includes("리셋 예정"), "relative mode must not show scheduled date text");

    await wait(5_250);
    const relativeAfterCycle = await win.webContents.executeJavaScript(`(() => ({
      checked: document.querySelector('input[name="resetDisplayMode"]:checked')?.value || '',
      resetText: document.querySelector('#list .sub')?.textContent || '',
    }))()`);
    assert.strictEqual(relativeAfterCycle.checked, "relative");
    assert.ok(relativeAfterCycle.resetText.includes("후 리셋"), "forced remaining-time mode must not alternate after five seconds");
    assert.ok(!relativeAfterCycle.resetText.includes("리셋 예정"), "forced remaining-time mode must stay stable");

    const absolute = await selectMode(win, "absolute");
    assert.strictEqual(absolute.saved, "absolute", "scheduled-date mode must persist");
    assert.strictEqual(absolute.checked, "absolute");
    assert.ok(absolute.resetText.includes("리셋 예정"), `absolute mode should show scheduled reset date/time (${absolute.resetText})`);

    const automatic = await selectMode(win, "auto");
    assert.strictEqual(automatic.saved, "auto", "automatic mode must persist");
    assert.strictEqual(automatic.checked, "auto");
    assert.ok(automatic.resetText.includes("후 리셋"), "automatic mode should restart from remaining-time display");

    console.log("reset display mode settings smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
