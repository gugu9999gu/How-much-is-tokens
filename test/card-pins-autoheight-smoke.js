const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

async function waitFor(win, expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await win.webContents.executeJavaScript(expression, true);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 620,
    height: 620,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "card-pins-autoheight-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await win.loadFile(path.join(__dirname, "card-pins-autoheight-fixture.html"));
    await waitFor(win, 'document.querySelectorAll(".card-pin-button").length === 2 && !!document.getElementById("autoHeightToggle")');

    const initial = await win.webContents.executeJavaScript(`({
      autoHeight: document.getElementById("autoHeightToggle").checked,
      keys: [...document.querySelectorAll("article.row")].map((row) => row.dataset.providerCardKey),
    })`, true);
    assert.strictEqual(initial.autoHeight, true);
    assert.deepStrictEqual(initial.keys, ["codex", "claude"]);

    await win.webContents.executeJavaScript(`document.querySelector('article.row[data-provider-card-key="claude"] .card-pin-button').click()`, true);
    await waitFor(win, `document.querySelector('.pinned-provider-group article.row')?.dataset.providerCardKey === 'claude'`);
    const pinned = await win.webContents.executeJavaScript(`({
      settings: window.cardPinTest.settings(),
      pinnedKey: document.querySelector('.pinned-provider-group article.row')?.dataset.providerCardKey,
      pressed: document.querySelector('.pinned-provider-group .card-pin-button')?.getAttribute('aria-pressed'),
    })`, true);
    assert.deepStrictEqual(pinned.settings.pinnedProviderCards, ["claude"]);
    assert.strictEqual(pinned.pinnedKey, "claude");
    assert.strictEqual(pinned.pressed, "true");

    await win.webContents.executeJavaScript(`document.getElementById("autoHeightToggle").click()`, true);
    await waitFor(win, `window.cardPinTest.settings().autoHeight === false && Number.isFinite(window.cardPinTest.settings().manualWindowSize?.height)`);
    const manual = await win.webContents.executeJavaScript(`window.cardPinTest.settings()`, true);
    assert.strictEqual(manual.autoHeight, false);
    assert.strictEqual(manual.manualWindowSize.height, 480);

    await win.webContents.executeJavaScript(`document.getElementById("autoHeightToggle").click()`, true);
    await waitFor(win, `window.cardPinTest.settings().autoHeight === true && !('height' in (window.cardPinTest.settings().manualWindowSize || {}))`);
    const automatic = await win.webContents.executeJavaScript(`window.cardPinTest.settings()`, true);
    assert.strictEqual(automatic.autoHeight, true);
    assert.deepStrictEqual(automatic.manualWindowSize, { width: 620 });

    console.log("card pin and auto-height Electron smoke passed");
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
