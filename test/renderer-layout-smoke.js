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
    await wait(220);

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
      const cliAutoUpdate = document.getElementById('cliAutoUpdate');
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
        cliAutoUpdateBasic: !!(cliAutoUpdate && cliAutoUpdate.closest('#basicSettings')),
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
        codexIdentity: document.querySelector('#list .account-identity-line')?.textContent || '',
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
    assert.strictEqual(connectionUi.cliAutoUpdateBasic, true, "CLI auto-update toggle should stay immediately accessible");
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
    assert.ok(connectionUi.codexIdentity.includes("codex@example.com"), "token card must show authenticated account email when available");
    assert.ok(connectionUi.codexIdentity.includes("acct_codex_123"), "token card must show authenticated account ID when available");

    const metaSlots = await win.webContents.executeJavaScript(`(() => {
      const slotNames = (providerId) => [...document.querySelectorAll('article[data-provider-id="' + providerId + '"] [data-meta-slot]')].map((el) => el.dataset.metaSlot);
      const column = (providerId, slot) => {
        const el = document.querySelector('article[data-provider-id="' + providerId + '"] [data-meta-slot="' + slot + '"]');
        return el ? getComputedStyle(el).gridColumnStart : "";
      };
      return {
        codex: slotNames("codex"),
        fal: slotNames("falai"),
        codexAccount: column("codex", "account"),
        codexBilling: column("codex", "billing"),
        codexVersion: column("codex", "version"),
        falAccount: column("falai", "account"),
        falBilling: column("falai", "billing"),
      };
    })()`);
    assert.deepStrictEqual(metaSlots.codex, ["account", "billing", "version", "coupon"], "Codex meta slots must stay in a fixed order");
    assert.deepStrictEqual(metaSlots.fal, ["account", "billing"], "providers without CLI or coupons must not insert extra leading slots");
    assert.strictEqual(metaSlots.codexAccount, "1");
    assert.strictEqual(metaSlots.falAccount, "1");
    assert.strictEqual(metaSlots.codexBilling, "2");
    assert.strictEqual(metaSlots.falBilling, "2", "limit renewal must line up with the same column on every platform");
    assert.strictEqual(metaSlots.codexVersion, "3");

    const compactMeta = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById("compactBtn").click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const card = document.querySelector('article[data-provider-id="codex"]');
      const billingDetail = card.querySelector(".meta-billing small");
      const versionDetail = card.querySelector(".meta-cli small");
      const accountDetail = card.querySelector(".meta-account small");
      return {
        compact: card.classList.contains("compact"),
        billingDisplay: billingDetail ? getComputedStyle(billingDetail).display : "",
        versionDisplay: versionDetail ? getComputedStyle(versionDetail).display : "",
        accountDisplay: accountDetail ? getComputedStyle(accountDetail).display : "",
        accountText: card.querySelector(".account-identity-line")?.textContent || "",
        quota: card.querySelector(".compact-quota")?.textContent || "",
        pin: !!card.querySelector(".pin-btn"),
        falCredit: document.querySelector('article[data-provider-id="falai"] .compact-credit')?.textContent || "",
        elevenCredit: document.querySelector('article[data-provider-id="elevenlabs"] .compact-credit')?.textContent || "",
        codexCredit: document.querySelector('article[data-provider-id="codex"] .compact-credit')?.textContent || "",
      };
    })()`);
    assert.strictEqual(compactMeta.compact, true, "compact toggle must mark the usage card");
    assert.strictEqual(compactMeta.billingDisplay, "", "compact mode must omit renewal, version, and account detail cards");
    assert.strictEqual(compactMeta.versionDisplay, "", "compact mode must omit the version card");
    assert.strictEqual(compactMeta.accountDisplay, "", "compact mode must omit account details");
    assert.strictEqual(compactMeta.accountText, "");
    assert.ok(compactMeta.quota.includes("75%"), "compact mode must show the remaining quota directly");

    const weeklyRenewal = await win.webContents.executeJavaScript("(() => {\n  const future = Date.now() + 6 * 24 * 60 * 60 * 1000;\n  const full = new Date(future);\n  const two = (n) => String(n).padStart(2, \"0\");\n  const formatted = (date) => (date.getMonth() + 1) + \"/\" + date.getDate() + \" \" + two(date.getHours()) + \":\" + two(date.getMinutes());\n  const session = { id: \"session\", label: \"5시간 한도\", remainingPct: 80, resetAt: future };\n  const weekly = { id: \"weekly-all\", label: \"주간 한도\", remainingPct: 63, resetAt: future };\n  const fable = { id: \"weekly-scoped-fable\", label: \"Fable 주간 한도\", remainingPct: 41, resetAt: future + 3600000 };\n  const provider = {\n    id: \"claude:profile:fixture\", providerId: \"claude\", name: \"Claude\", status: \"ok\", plan: \"Max\",\n    remainingPct: 80, windows: [session, weekly, fable], extras: []\n  };\n  const element = document.createElement(\"div\");\n  element.innerHTML = renderProviderCard(provider);\n  const rows = [...element.querySelectorAll(\".compact-quota\")].map((row) => ({\n    label: row.querySelector(\"span:first-child\")?.textContent || \"\",\n    reset: row.querySelector(\".compact-quota-reset\")?.textContent || \"\"\n  }));\n  const codexHtml = renderCompactQuotas({\n    id: \"codex\", providerId: \"codex\",\n    windows: [{ id: \"weekly\", label: \"주간 한도\", remainingPct: 72, resetAt: future }]\n  });\n  return {\n    rows, expected: formatted(full), fableExpected: formatted(new Date(future + 3600000)),\n    missing: compactWeeklyResetText({ ...weekly, resetAt: null }),\n    invalid: compactWeeklyResetText({ ...weekly, resetAt: \"invalid\" }),\n    expired: compactWeeklyResetText({ ...weekly, resetAt: Date.now() - 60 * 1000 }),\n    fiveHour: compactWeeklyResetText(session),\n    codex: codexHtml.includes(\"갱신 \" + formatted(full)),\n    percent: element.querySelectorAll(\".compact-quota b\")[1]?.textContent || \"\"\n  };\n})()");
    assert.deepStrictEqual(weeklyRenewal.rows.map((row) => row.label), ["5시간 한도", "주간 한도", "Fable 주간 한도"]);
    assert.strictEqual(weeklyRenewal.rows[0].reset, "", "5-hour window must not show a weekly reset date");
    assert.strictEqual(weeklyRenewal.rows[1].reset, "갱신 " + weeklyRenewal.expected);
    assert.strictEqual(weeklyRenewal.rows[2].reset, "갱신 " + weeklyRenewal.fableExpected);
    assert.strictEqual(weeklyRenewal.percent, "63%", "short date must not replace the remaining percentage");
    assert.strictEqual(weeklyRenewal.missing, "", "missing resetAt must not become a fabricated date");
    assert.strictEqual(weeklyRenewal.invalid, "", "invalid resetAt must not become a fabricated date");
    assert.strictEqual(weeklyRenewal.expired, "", "expired timestamps must not display a future renewal");
    assert.strictEqual(weeklyRenewal.fiveHour, "");
    assert.strictEqual(weeklyRenewal.codex, true, "weekly reset abbreviation must work for other providers");

    const sharedClaudeReset = await win.webContents.executeJavaScript("(() => {\n  const now = Date.now();\n  const future = Math.floor((now + 5 * 86400000) / 60000) * 60000;\n  const weekly = { id: \"weekly-all\", label: \"주간 한도\", remainingPct: 64, resetAt: future };\n  const fable = { id: \"weekly-scoped-fable\", label: \"Fable 주간 한도\", remainingPct: 80, resetAt: future };\n  const session = { id: \"session\", label: \"5시간 한도\", remainingPct: 91, resetAt: now + 1800000 };\n  const provider = { id: \"claude:profile:shared\", providerId: \"claude\", name: \"Claude\", status: \"ok\" };\n  const sample = (windows, overrides = {}) => {\n    const el = document.createElement(\"div\");\n    el.innerHTML = renderCompactQuotas({ ...provider, windows, ...overrides });\n    return {\n      resets: [...el.querySelectorAll(\".compact-quota-reset\")].map((node) => node.textContent),\n      percentages: [...el.querySelectorAll(\".compact-quota > b\")].map((node) => node.textContent),\n    };\n  };\n  return {\n    shared: sample([session, weekly, fable]),\n    sameMinute: sample([session, weekly, { ...fable, resetAt: future + 15000 }]),\n    different: sample([session, weekly, { ...fable, resetAt: future + 60000 }]),\n    missing: sample([session, weekly, { ...fable, resetAt: null }]),\n    fableOnly: sample([session, fable]),\n    expired: sample([session, { ...weekly, resetAt: now - 60000 }, { ...fable, resetAt: now - 60000 }]),\n    otherProvider: sample([session, weekly, fable], { id: \"antigravity\", providerId: \"antigravity\" }),\n    legacy: sample([session, { ...weekly, id: \"seven_day\" }, { ...fable, id: \"fable\" }]),\n    secondAccount: sample([session, weekly, { ...fable, resetAt: future + 86400000 }], { id: \"claude:profile:other\" }),\n    expected: compactWeeklyResetText(weekly, now),\n  };\n})()");
    assert.deepStrictEqual(sharedClaudeReset.shared.resets, ["주간·Fable 갱신 " + sharedClaudeReset.expected], "identical Claude weekly and Fable reset times must render once");
    assert.deepStrictEqual(sharedClaudeReset.shared.percentages, ["91%", "64%", "80%"], "separate usage meters must be preserved");
    assert.deepStrictEqual(sharedClaudeReset.sameMinute.resets, sharedClaudeReset.shared.resets, "timestamps in the same displayed minute must combine");
    assert.strictEqual(sharedClaudeReset.different.resets.length, 2, "different weekly timestamps must remain separate");
    assert.deepStrictEqual(sharedClaudeReset.missing.resets, ["갱신 " + sharedClaudeReset.expected], "missing model timestamp must not inherit the weekly timestamp");
    assert.deepStrictEqual(sharedClaudeReset.fableOnly.resets, ["갱신 " + sharedClaudeReset.expected], "a lone Fable allowance must show its own timestamp");
    assert.strictEqual(sharedClaudeReset.expired.resets.length, 0, "expired timestamps must not be presented as a common future renewal");
    assert.strictEqual(sharedClaudeReset.otherProvider.resets.length, 2, "other providers keep existing rendering");
    assert.deepStrictEqual(sharedClaudeReset.legacy.resets, sharedClaudeReset.shared.resets, "legacy Claude weekly/Fable IDs must also combine");
    assert.strictEqual(sharedClaudeReset.secondAccount.resets.length, 2, "each account must use its own timestamps");

    assert.ok(compactMeta.falCredit.includes("$42.50"), "compact mode must show held credits when AI usage is zero");
    assert.strictEqual(compactMeta.elevenCredit, "", "compact mode must keep a usage meter from being repeated as credits");
    assert.ok(compactMeta.codexCredit.includes("1200"), "compact mode must show Codex credits while a quota window is still in use");
    assert.strictEqual(compactMeta.pin, true, "each token card must expose a pin control");

    const claudeCompact = await win.webContents.executeJavaScript("(() => {\n  const multi = {\n    id: \"claude:profile:first\", providerId: \"claude\", name: \"Claude\", status: \"ok\", plan: \"Max\",\n    remainingPct: 70, windows: [\n      { id: \"session\", label: \"5시간 한도\", remainingPct: 70 },\n      { id: \"weekly-all\", label: \"주간 한도\", remainingPct: 60 },\n      { id: \"weekly-scoped-sonnet\", label: \"Sonnet 주간 한도\", remainingPct: 50 },\n      { id: \"weekly-scoped-opus\", label: \"Opus 주간 한도\", remainingPct: 40 },\n      { id: \"weekly-scoped-fable\", label: \"Fable 주간 한도\", remainingPct: 30 }\n    ], extras: []\n  };\n  const selected = compactQuotaWindows(multi);\n  const compactHtml = renderProviderCard(multi);\n  const proWithoutBucket = {\n    ...multi, id: \"claude:profile:second\", plan: \"Pro\",\n    windows: multi.windows.slice(0, 2),\n    extras: [{ label: \"Fable\", value: \"별도 주간 한도 없음 · 크레딧 기반\" }]\n  };\n  const maxWithoutBucket = {\n    ...proWithoutBucket, id: \"claude:profile:third\", plan: \"Max\",\n    extras: [{ label: \"Fable\", value: \"API에 모델별 한도 미제공\" }]\n  };\n  return {\n    labels: selected.map((win) => win.label),\n    compactHtmlHasFable: compactHtml.includes(\"Fable 주간 한도\"),\n    proNotice: renderProviderCard(proWithoutBucket).includes(\"Fable 크레딧 기반\"),\n    maxNotice: renderProviderCard(maxWithoutBucket).includes(\"Fable 한도 미제공\")\n  };\n})()");
    assert.deepStrictEqual(claudeCompact.labels, ["5시간 한도", "주간 한도", "Fable 주간 한도"],
      "compact Claude cards must not hide Fable behind other model-scoped limits");
    assert.strictEqual(claudeCompact.compactHtmlHasFable, true);
    assert.strictEqual(claudeCompact.proNotice, true, "Pro account must identify credit-based Fable access");
    assert.strictEqual(claudeCompact.maxNotice, true, "eligible account with no scoped data must show unknown");


    const pinOrder = await win.webContents.executeJavaScript(`(async () => {
      const pin = async (providerId) => {
        document.querySelector('article[data-provider-id="' + providerId + '"] .pin-btn').click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      await pin("falai");
      await pin("codex");
      const keys = () => [...document.querySelectorAll("[data-pin-group] article")].map((el) => el.dataset.pinKey);
      const before = keys();
      const cards = [...document.querySelectorAll("[data-pin-group] article")];
      const data = typeof DataTransfer === "function" ? new DataTransfer() : null;
      cards[1].dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
      cards[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
      cards[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { before, after: keys(), saved: (await window.tokenWidget.getSettings()).pinnedAccounts };
    })()`);
    assert.deepStrictEqual(pinOrder.before, ["codex:default", "falai:default"], "pinning must place the newest account first");
    assert.deepStrictEqual(pinOrder.after, ["falai:default", "codex:default"], "dropping a pinned card must move it ahead of the target");
    assert.deepStrictEqual(pinOrder.saved, ["falai:default", "codex:default"], "the new pin order must be saved");

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
