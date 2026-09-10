const assert = require("assert");
const path = require("path");
const { app, BrowserWindow } = require("electron");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 430,
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
    await wait(450);

    const initial = await win.webContents.executeJavaScript(`(() => ({
      manager: !!document.getElementById('openRouterQuickManager'),
      addKey: document.getElementById('openRouterAddKey')?.textContent || '',
      addOAuth: document.getElementById('openRouterAddOAuth')?.textContent || '',
      cards: document.querySelectorAll('.openrouter-profile-card').length,
      empty: document.querySelector('.openrouter-profile-empty')?.textContent || '',
      advancedClosed: document.querySelector('.openrouter-advanced-details')?.open === false,
      legacyInsideAdvanced: !!document.querySelector('.openrouter-advanced-details #openRouterProfiles'),
    }))()`);
    assert.strictEqual(initial.manager, true, "OpenRouter quick manager must be installed");
    assert.ok(initial.addKey.includes("API Key"));
    assert.ok(initial.addOAuth.includes("로그인"));
    assert.strictEqual(initial.cards, 0);
    assert.ok(initial.empty.includes("추적 중인 OpenRouter 키가 없습니다"));
    assert.strictEqual(initial.advancedClosed, true, "legacy text editor must be collapsed behind advanced settings");
    assert.strictEqual(initial.legacyInsideAdvanced, true, "legacy editor must remain available for compatibility");

    const first = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('openRouterAddKey').click();
      document.getElementById('openRouterNewLabel').value = '업무 키';
      document.getElementById('openRouterNewApiKey').value = ['fixture','openrouter','work','key'].join('-');
      document.getElementById('openRouterNewManagementKey').value = ['fixture','management','key'].join('-');
      document.getElementById('openRouterConfirmAddKey').click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const settings = await window.tokenWidget.getSettings();
      return {
        cards: document.querySelectorAll('.openrouter-profile-card').length,
        title: document.querySelector('.openrouter-profile-title strong')?.textContent || '',
        detail: document.querySelector('.openrouter-profile-detail')?.textContent || '',
        openRouterEnabled: settings.openRouterEnabled,
        profiles: settings.openRouterProfiles.map((profile) => ({ id: profile.id, label: profile.label, priority: profile.priority })),
      };
    })()`);
    assert.strictEqual(first.cards, 1);
    assert.strictEqual(first.title, "업무 키");
    assert.ok(first.detail.includes("API Key"));
    assert.ok(first.detail.includes("크레딧 조회"));
    assert.strictEqual(first.openRouterEnabled, true);
    assert.deepStrictEqual(first.profiles, [{ id: "default", label: "업무 키", priority: 10 }]);

    const second = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('openRouterAddKey').click();
      document.getElementById('openRouterNewLabel').value = '백업 키';
      document.getElementById('openRouterNewApiKey').value = ['fixture','openrouter','backup','key'].join('-');
      document.getElementById('openRouterConfirmAddKey').click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        cards: [...document.querySelectorAll('.openrouter-profile-title strong')].map((el) => el.textContent),
        settings: (await window.tokenWidget.getSettings()).openRouterProfiles.map((profile) => ({ id: profile.id, priority: profile.priority })),
      };
    })()`);
    assert.deepStrictEqual(second.cards, ["업무 키", "백업 키"]);
    assert.deepStrictEqual(second.settings, [{ id: "default", priority: 10 }, { id: "key-2", priority: 20 }]);

    const reordered = await win.webContents.executeJavaScript(`(async () => {
      const secondCard = document.querySelectorAll('.openrouter-profile-card')[1];
      secondCard.querySelector('.openrouter-card-actions button').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        cards: [...document.querySelectorAll('.openrouter-profile-title strong')].map((el) => el.textContent),
        priorities: (await window.tokenWidget.getSettings()).openRouterProfiles.map((profile) => profile.priority),
      };
    })()`);
    assert.deepStrictEqual(reordered.cards, ["백업 키", "업무 키"], "arrow buttons must reorder router priority without editing numeric values");
    assert.deepStrictEqual(reordered.priorities, [10, 20]);

    const oauth = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('openRouterAddOAuth').click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        count: document.querySelectorAll('.openrouter-profile-card').length,
        labels: [...document.querySelectorAll('.openrouter-profile-title strong')].map((el) => el.textContent),
      };
    })()`);
    assert.strictEqual(oauth.count, 3);
    assert.ok(oauth.labels.some((label) => label.includes("OpenRouter 로그인")), "OAuth add action must appear in the same manager");

    const edited = await win.webContents.executeJavaScript(`(async () => {
      const editButton = [...document.querySelectorAll('.openrouter-profile-card')]
        .find((card) => card.querySelector('.openrouter-profile-title strong')?.textContent === '업무 키')
        ?.querySelectorAll('.openrouter-card-actions button')[2];
      editButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        advancedOpen: document.querySelector('.openrouter-advanced-details').open,
        selected: document.getElementById('openRouterProfileSelect').value,
      };
    })()`);
    assert.strictEqual(edited.advancedOpen, true);
    assert.strictEqual(edited.selected, "default", "card edit must select the matching legacy profile editor");

    const removed = await win.webContents.executeJavaScript(`(async () => {
      window.confirm = () => true;
      const firstCard = document.querySelector('.openrouter-profile-card');
      firstCard.querySelector('.openrouter-card-actions .subtle-danger').click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        count: document.querySelectorAll('.openrouter-profile-card').length,
        profileCount: (await window.tokenWidget.getSettings()).openRouterProfiles.length,
      };
    })()`);
    assert.strictEqual(removed.count, 2);
    assert.strictEqual(removed.profileCount, 2, "delete must remove profile metadata together with its stored-key state");

    console.log("OpenRouter intuitive profile manager smoke test passed");
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
