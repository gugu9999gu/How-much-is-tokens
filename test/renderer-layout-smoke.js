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
    await wait(180);

    const connectionUi = await win.webContents.executeJavaScript(`(() => {
      const hub = document.getElementById('connectionHub');
      const basic = document.getElementById('basicSettings');
      const advanced = document.getElementById('advancedSettings');
      const cards = [...document.querySelectorAll('[data-connection-provider]')].map((el) => el.dataset.connectionProvider);
      const manualProfile = document.getElementById('accountProfiles');
      const apiKey = document.getElementById('openRouterApiKey');
      const alwaysOnTop = document.getElementById('alwaysOnTop');
      const openAtLogin = document.getElementById('openAtLogin');
      const hideMissing = document.getElementById('hideMissing');
      const denseLayout = document.getElementById('denseLayout');
      const opacity = document.getElementById('opacity');
      return {
        hub: !!hub,
        basic: !!basic,
        advanced: !!advanced,
        advancedOpen: !!(advanced && advanced.open),
        cards,
        alwaysOnTopBasic: !!(alwaysOnTop && alwaysOnTop.closest('#basicSettings')),
        openAtLoginBasic: !!(openAtLogin && openAtLogin.closest('#basicSettings')),
        hideMissingBasic: !!(hideMissing && hideMissing.closest('#basicSettings')),
        denseAdvanced: !!(denseLayout && denseLayout.closest('#advancedSettings')),
        opacityAdvanced: !!(opacity && opacity.closest('#advancedSettings')),
        manualProfileAdvanced: !!(manualProfile && manualProfile.closest('#advancedSettings')),
        apiKeyAdvanced: !!(apiKey && apiKey.closest('#advancedSettings')),
        codexStatus: document.querySelector('[data-connection-status="codex"]')?.textContent || '',
        headerEdgeToggle: !!document.getElementById('headerEdgeDockToggle'),
        resizeHandles: document.querySelectorAll('.widget-resize-handle').length,
        codexCli: document.querySelector('[data-connection-provider="codex"] .cli-version-line')?.textContent || '',
        codexUpdate: !!document.querySelector('[data-connection-provider="codex"] .cli-update-btn'),
        codexDisconnect: !!document.querySelector('[data-connection-provider="codex"] .connection-account-chip button'),
      };
    })()`);
    assert.strictEqual(connectionUi.hub, true, "minimal connection hub must exist");
    assert.strictEqual(connectionUi.basic, true, "essential settings group must exist");
    assert.strictEqual(connectionUi.advanced, true, "advanced settings disclosure must exist");
    assert.strictEqual(connectionUi.advancedOpen, false, "advanced settings must start collapsed");
    assert.deepStrictEqual(connectionUi.cards, ["codex", "claude", "grok", "cursor", "grokbot", "copilot", "antigravity", "openrouter"]);
    assert.strictEqual(connectionUi.alwaysOnTopBasic, true, "always-on-top should stay immediately accessible");
    assert.strictEqual(connectionUi.openAtLoginBasic, true, "startup toggle should stay immediately accessible");
    assert.strictEqual(connectionUi.hideMissingBasic, true, "hide-missing toggle should stay immediately accessible");
    assert.strictEqual(connectionUi.denseAdvanced, true, "dense layout should be hidden under advanced settings");
    assert.strictEqual(connectionUi.opacityAdvanced, true, "opacity should be hidden under advanced settings");
    assert.strictEqual(connectionUi.manualProfileAdvanced, true, "raw account profile editor must move under advanced settings");
    assert.strictEqual(connectionUi.apiKeyAdvanced, true, "manual OpenRouter API key must move under advanced settings");
    assert.ok(connectionUi.codexStatus.includes("연결됨"), "connection hub should render latest provider state");
    assert.strictEqual(connectionUi.headerEdgeToggle, true, "edge-dock switch must be available directly in the titlebar");
    assert.strictEqual(connectionUi.resizeHandles, 8, "all four borders and corners must expose resize hit targets");
    assert.ok(connectionUi.codexCli.includes("1.0.0"), "installed CLI version must be visible in the connection card");
    assert.strictEqual(connectionUi.codexUpdate, true, "detected CLI update must expose an update button");
    assert.strictEqual(connectionUi.codexDisconnect, true, "connected account must expose a disconnect control");

    const headerToggleWorked = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('headerEdgeDockToggle').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const enabled = (await window.tokenWidget.getSettings()).edgeDockEnabled === true;
      document.getElementById('headerEdgeDockToggle').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const disabled = (await window.tokenWidget.getSettings()).edgeDockEnabled === false;
      return enabled && disabled;
    })()`);
    assert.strictEqual(headerToggleWorked, true, "titlebar edge switch must persist the same setting without opening settings");

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
      const advanced = document.getElementById('advancedSettings');
      advanced.open = true;
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

    console.log("renderer minimal connection/settings layout smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
