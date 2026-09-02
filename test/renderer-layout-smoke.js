const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sample(win) {
  return win.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.shell');
    const title = document.querySelector('.titlebar');
    const viewport = document.getElementById('contentViewport');
    const settings = document.getElementById('settings');
    const t = title.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    const s = settings.getBoundingClientRect();
    return {
      title: { top: t.top, bottom: t.bottom, height: t.height },
      viewport: { top: v.top, bottom: v.bottom, height: v.height },
      settings: { top: s.top, bottom: s.bottom, height: s.height, scrollTop: settings.scrollTop },
      edge: shell.classList.contains('edge-dock-enabled'),
      rootScroll: window.scrollY,
    };
  })()`);
}

function assertSeparated(snapshot, label) {
  assert.ok(snapshot.title.height >= 26, `${label}: titlebar collapsed`);
  assert.ok(snapshot.title.top >= 0, `${label}: titlebar escaped above viewport`);
  assert.ok(
    snapshot.viewport.top >= snapshot.title.bottom - 0.5,
    `${label}: content viewport overlaps titlebar (${snapshot.viewport.top} < ${snapshot.title.bottom})`,
  );
  assert.ok(
    snapshot.settings.top >= snapshot.viewport.top - 0.5,
    `${label}: settings escaped content viewport`,
  );
  assert.strictEqual(snapshot.rootScroll, 0, `${label}: root document scrolled`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 332,
    height: 580,
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
    await wait(80);

    await win.webContents.executeJavaScript(`(() => {
      document.getElementById('settingsBtn').click();
      return true;
    })()`);
    await wait(50);

    await win.webContents.executeJavaScript(`(() => {
      const settings = document.getElementById('settings');
      settings.scrollTop = 320;
      window.scrollTo(0, 200);
      return settings.scrollTop;
    })()`);
    await wait(30);

    const before = await sample(win);
    assert.ok(before.settings.scrollTop > 0, "fixture must actually scroll settings");
    assertSeparated(before, "before edge toggle");

    await win.webContents.executeJavaScript(`(() => {
      const toggle = document.getElementById('edgeDockEnabled');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(80);
    win.setPosition(0, 0, false);
    await wait(30);

    const enabled = await sample(win);
    assert.strictEqual(enabled.edge, true, "edge class was not enabled");
    assertSeparated(enabled, "edge enabled");
    assert.ok(
      Math.abs(enabled.title.top - before.title.top) < 0.5,
      "edge toggle moved titlebar inside renderer",
    );

    win.setSize(332, 320, false);
    await wait(60);
    const constrained = await sample(win);
    assertSeparated(constrained, "edge enabled / short window");

    await win.webContents.executeJavaScript(`(() => {
      const side = document.querySelector('input[name="edgeDockSide"][value="left"]');
      side.checked = true;
      side.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(70);
    const sideChanged = await sample(win);
    assertSeparated(sideChanged, "edge side changed");

    await win.webContents.executeJavaScript(`(() => {
      const toggle = document.getElementById('edgeDockEnabled');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(70);
    const disabled = await sample(win);
    assert.strictEqual(disabled.edge, false, "edge class was not disabled");
    assertSeparated(disabled, "edge disabled");

    console.log("renderer titlebar/content viewport smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
