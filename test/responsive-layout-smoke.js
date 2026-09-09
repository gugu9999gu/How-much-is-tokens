const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function widestProviderGroup(win) {
  return win.webContents.executeJavaScript(`(() => {
    const groups = [...document.querySelectorAll('.provider-group-cards')]
      .map((group) => ({ group, cards: [...group.querySelectorAll(':scope > .row')] }))
      .filter((entry) => entry.cards.length >= 2)
      .sort((a, b) => b.cards.length - a.cards.length);
    const selected = groups[0];
    if (!selected) return null;
    const firstTop = selected.cards[0].getBoundingClientRect().top;
    const columns = selected.cards.filter((card) =>
      Math.abs(card.getBoundingClientRect().top - firstTop) < 1
    ).length;
    const style = getComputedStyle(selected.group);
    return {
      display: style.display,
      columns,
      count: selected.cards.length,
      width: selected.group.getBoundingClientRect().width,
      template: style.gridTemplateColumns,
    };
  })()`);
}

async function settingsViewportState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const settings = document.getElementById('settings');
    const viewport = document.getElementById('contentViewport');
    const advanced = document.getElementById('advancedSettings');
    if (advanced) advanced.open = true;
    document.querySelectorAll('.settings-section').forEach((section) => section.classList.add('is-open'));

    const s = settings.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    settings.scrollTop = settings.scrollHeight;
    const actions = settings.querySelector('.settings-actions');
    const a = actions ? actions.getBoundingClientRect() : null;
    const style = getComputedStyle(settings);
    return {
      settingsHeight: s.height,
      viewportHeight: v.height,
      scrollHeight: settings.scrollHeight,
      clientHeight: settings.clientHeight,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      scrollTop: settings.scrollTop,
      actionsVisible: !a || (a.bottom <= s.bottom + 2 && a.top >= s.top - 2),
    };
  })()`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 332,
    height: 650,
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
    await wait(220);

    const narrow = await widestProviderGroup(win);
    assert.ok(narrow, "fixture needs a provider group containing multiple visible cards");
    assert.strictEqual(narrow.display, "grid", "provider cards must use a responsive CSS grid");
    assert.strictEqual(narrow.columns, 1, "default/narrow widget width must keep a single readable column");

    win.setSize(620, 650, false);
    await wait(120);
    const medium = await widestProviderGroup(win);
    assert.ok(medium.columns >= 2, `620px widget should expose at least two card columns, got ${medium.columns} (${medium.template})`);

    win.setSize(900, 650, false);
    await wait(120);
    const wide = await widestProviderGroup(win);
    assert.ok(wide.columns >= 3, `900px widget should expose at least three card columns, got ${wide.columns} (${wide.template})`);

    win.setSize(620, 760, false);
    await wait(100);
    await win.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('settingsBtn');
      if (!document.querySelector('.shell').classList.contains('settings-open')) button.click();
      return true;
    })()`);
    await wait(140);

    const settings = await settingsViewportState(win);
    assert.ok(settings.viewportHeight > 560, `tall fixture must provide more than the legacy 520px cap (${settings.viewportHeight})`);
    assert.ok(
      settings.settingsHeight >= settings.viewportHeight - 2,
      `settings must fill the resized content viewport (${settings.settingsHeight} vs ${settings.viewportHeight})`,
    );
    assert.ok(settings.clientHeight > 520, `settings client height must not retain the legacy 520px cap (${settings.clientHeight})`);
    assert.ok(settings.scrollHeight > settings.clientHeight, "expanded settings fixture must remain vertically scrollable");
    assert.ok(["auto", "scroll"].includes(settings.overflowY), `settings must own vertical scrolling, got ${settings.overflowY}`);
    assert.strictEqual(settings.actionsVisible, true, "scrolling to the end must reveal the final settings controls without clipping");

    console.log("responsive token grid and full-height settings viewport smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
