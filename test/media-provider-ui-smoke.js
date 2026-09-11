const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 560,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "media-provider-ui-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    await win.loadFile(path.join(__dirname, "media-provider-ui-fixture.html"));
    await wait(250);
    const initial = await win.webContents.executeJavaScript(`(() => {
      const fal = document.querySelector('[data-api-provider="falai"]');
      const stability = document.querySelector('[data-api-provider="stability"]');
      return {
        cards: document.querySelectorAll('[data-api-provider]').length,
        falButtons: [...fal.querySelectorAll('button')].map((b) => b.textContent.trim()),
        stabilityText: stability.textContent,
      };
    })()`);
    assert.strictEqual(initial.cards, 3);
    assert.ok(initial.falButtons.includes("+ API 계정"));
    assert.ok(initial.falButtons.includes("+ MCP 키"));
    assert.ok(initial.stabilityText.includes("공식 잔액 MCP 없음"));

    const falAdded = await win.webContents.executeJavaScript(`(async () => {
      const card = document.querySelector('[data-api-provider="falai"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ API 계정').click();
      card.querySelector('[data-media-label]').value = 'Fal Team';
      card.querySelector('[data-api-field="apiKey"]').value = ['fal','ui','fixture'].join('-');
      [...card.querySelectorAll('[data-media-account-editor] button')].find((b) => b.textContent.trim() === '추가하고 추적').click();
      await new Promise((resolve) => setTimeout(resolve, 160));
      const row = card.querySelector('[data-media-profile-id]');
      return { label: row?.textContent || '', badge: row?.querySelector('.media-mode-badge')?.textContent || '', count: card.querySelectorAll('[data-media-profile-id]').length };
    })()`);
    assert.strictEqual(falAdded.count, 1);
    assert.ok(falAdded.label.includes("Fal Team"));
    assert.strictEqual(falAdded.badge, "API");

    const mcpAdded = await win.webContents.executeJavaScript(`(async () => {
      const card = document.querySelector('[data-api-provider="higgsfield"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ MCP 계정').click();
      card.querySelector('[data-media-label]').value = 'Higgs OAuth';
      [...card.querySelectorAll('[data-media-account-editor] button')].find((b) => b.textContent.trim() === '브라우저에서 연결').click();
      await new Promise((resolve) => setTimeout(resolve, 160));
      const row = card.querySelector('[data-media-profile-id]');
      return { text: row?.textContent || '', badge: row?.querySelector('.media-mode-badge')?.textContent || '' };
    })()`);
    assert.ok(mcpAdded.text.includes("Higgs OAuth"));
    assert.strictEqual(mcpAdded.badge, "MCP");

    const disabled = await win.webContents.executeJavaScript(`(async () => {
      const card = document.querySelector('[data-api-provider="falai"]');
      const toggle = card.querySelector('[data-media-profile-id] .media-mini-toggle input');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      return card.querySelector('[data-media-profile-id] .media-mini-toggle input')?.checked;
    })()`);
    assert.strictEqual(disabled, false, "per-account tracking toggle must persist");

    const removed = await win.webContents.executeJavaScript(`(async () => {
      window.confirm = () => true;
      const card = document.querySelector('[data-api-provider="falai"]');
      [...card.querySelectorAll('[data-media-profile-id] button')].find((b) => b.textContent.trim() === '삭제').click();
      await new Promise((resolve) => setTimeout(resolve, 140));
      return card.querySelectorAll('[data-media-profile-id]').length;
    })()`);
    assert.strictEqual(removed, 0);

    console.log("media provider account UI smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
