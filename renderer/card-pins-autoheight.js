(() => {
  const api = window.tokenWidget;
  const list = document.getElementById("list");
  if (!api || !list) return;

  const MAX_PINNED_CARDS = 64;
  let usagePayload = typeof api.getLastUsage === "function" ? api.getLastUsage() : null;
  let settingsCache = usagePayload && usagePayload.settings ? usagePayload.settings : {};
  let syncQueued = false;
  let settingsRefreshTimer = null;

  function installStyle() {
    if (document.querySelector('link[data-card-pins-autoheight="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "card-pins-autoheight.css";
    link.dataset.cardPinsAutoheight = "1";
    document.head.appendChild(link);
  }

  function cleanCardKey(value) {
    const key = String(value || "").trim();
    if (!key || key.length > 160 || !/^[a-zA-Z0-9:._-]+$/.test(key)) return null;
    return key;
  }

  function providerCardKey(row) {
    return cleanCardKey(row && (row.instanceKey || row.id || row.providerId));
  }

  function normalizePinnedCards(value) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
      const key = cleanCardKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= MAX_PINNED_CARDS) break;
    }
    return out;
  }

  function visibleRows(payload, settings) {
    const rows = Array.isArray(payload && payload.providers) ? payload.providers.filter(Boolean) : [];
    const hideMissing = !(settings && settings.hideMissing === false);
    return hideMissing ? rows.filter((row) => row.status !== "missing") : rows;
  }

  function hasManualHeight(settings) {
    return !!(settings && settings.manualWindowSize && Number.isFinite(Number(settings.manualWindowSize.height)));
  }

  function autoHeightEnabled(settings) {
    if (hasManualHeight(settings)) return false;
    return !(settings && settings.autoHeight === false);
  }

  function syncAutoHeightControl(settings = settingsCache) {
    const input = document.getElementById("autoHeightToggle");
    if (input) input.checked = autoHeightEnabled(settings);
  }

  function rerenderWithSettings(settings) {
    settingsCache = settings || {};
    if (usagePayload) usagePayload = { ...usagePayload, settings: settingsCache };
    syncAutoHeightControl(settingsCache);
    if (usagePayload && typeof window.render === "function") {
      window.render({ ...usagePayload, settings: settingsCache });
    } else {
      scheduleCardSync();
    }
  }

  async function setAutoHeight(enabled) {
    const input = document.getElementById("autoHeightToggle");
    if (input) input.disabled = true;
    try {
      let settings = typeof api.getSettings === "function" ? await api.getSettings() : settingsCache;
      if (enabled) {
        const manual = settings && settings.manualWindowSize && typeof settings.manualWindowSize === "object"
          ? settings.manualWindowSize
          : null;
        const width = manual && Number.isFinite(Number(manual.width)) ? Math.round(Number(manual.width)) : null;
        settings = await api.saveSettings({
          autoHeight: true,
          manualWindowSize: width ? { width } : null,
        });
      } else {
        if (typeof api.manualWindowResize !== "function") throw new Error("수동 높이 저장 기능을 사용할 수 없습니다.");
        const start = await api.manualWindowResize({ phase: "start", direction: "s", x: 0, y: 0 });
        if (!start || start.ok === false) throw new Error("현재 위젯 높이를 저장하지 못했습니다.");
        const end = await api.manualWindowResize({ phase: "end", direction: "s", x: 0, y: 0 });
        if (!end || end.ok === false) throw new Error("현재 위젯 높이를 저장하지 못했습니다.");
        settings = await api.saveSettings({ autoHeight: false });
      }
      rerenderWithSettings(settings);
    } catch (err) {
      syncAutoHeightControl(settingsCache);
      const message = document.getElementById("connectionHubMessage");
      if (message) {
        message.textContent = err && err.message ? err.message : String(err);
        message.classList.add("warning");
      }
    } finally {
      if (input) input.disabled = false;
    }
  }

  function installAutoHeightSetting() {
    if (document.getElementById("autoHeightToggle")) return;
    const anchor = document.getElementById("tokenAreaMaxHeight")?.closest("label");
    const group = anchor?.closest(".set-group") || document.getElementById("alwaysOnTop")?.closest(".set-group");
    if (!group) return;

    const label = document.createElement("label");
    label.className = "toggle auto-height-toggle";
    const copy = document.createElement("span");
    copy.className = "toggle-copy";
    const title = document.createElement("b");
    title.textContent = "높이 자동 조절";
    const detail = document.createElement("small");
    detail.textContent = "카드와 설정 내용에 맞춰 위젯 높이를 자동으로 조절";
    copy.append(title, detail);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "autoHeightToggle";
    input.setAttribute("aria-label", "위젯 높이 자동 조절");
    const track = document.createElement("span");
    track.className = "switch";
    track.setAttribute("aria-hidden", "true");
    label.append(copy, input, track);
    if (anchor) group.insertBefore(label, anchor);
    else group.appendChild(label);

    input.addEventListener("change", () => setAutoHeight(input.checked));
    syncAutoHeightControl();
  }

  function ensurePinButton(card, key, pinned) {
    if (!card || !key) return;
    card.dataset.providerCardKey = key;
    card.classList.add("has-card-pin");
    card.classList.toggle("pinned-card", pinned);
    let button = card.querySelector(":scope > .card-pin-button");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "card-pin-button";
      button.dataset.providerPin = key;
      card.appendChild(button);
    }
    button.dataset.providerPin = key;
    button.classList.toggle("active", pinned);
    button.setAttribute("aria-pressed", pinned ? "true" : "false");
    button.setAttribute("aria-label", pinned ? "상단 고정 해제" : "카드를 상단에 고정");
    button.title = pinned ? "상단 고정 해제" : "상단 고정";
    button.textContent = "⌖";
  }

  function assignFreshCardKeys(rows, settings) {
    const cards = [...list.querySelectorAll("article.row")];
    const fresh = cards.filter((card) => !card.dataset.providerCardKey);
    if (!fresh.length) return;
    const visible = visibleRows(usagePayload, settings);
    if (cards.length !== visible.length) return;
    cards.forEach((card, index) => {
      const key = providerCardKey(visible[index]);
      if (key) card.dataset.providerCardKey = key;
    });
  }

  function pinnedGroup() {
    return list.querySelector(":scope > .pinned-provider-group");
  }

  function createPinnedGroup() {
    let group = pinnedGroup();
    if (group) return group;
    group = document.createElement("section");
    group.className = "provider-group pinned-provider-group";
    const head = document.createElement("div");
    head.className = "provider-group-head";
    const title = document.createElement("span");
    title.textContent = "고정";
    const line = document.createElement("i");
    head.append(title, line);
    const cards = document.createElement("div");
    cards.className = "provider-group-cards pinned-provider-cards";
    group.append(head, cards);
    list.prepend(group);
    return group;
  }

  function syncPinnedPlacement(settings) {
    const pins = normalizePinnedCards(settings && settings.pinnedProviderCards);
    const pinSet = new Set(pins);
    assignFreshCardKeys(visibleRows(usagePayload, settings), settings);

    const cards = [...list.querySelectorAll("article.row[data-provider-card-key]")];
    cards.forEach((card) => ensurePinButton(card, card.dataset.providerCardKey, pinSet.has(card.dataset.providerCardKey)));

    const desiredPinned = pins
      .map((key) => cards.find((card) => card.dataset.providerCardKey === key))
      .filter(Boolean);

    if (desiredPinned.length) {
      const group = createPinnedGroup();
      const holder = group.querySelector(".pinned-provider-cards");
      const currentKeys = [...holder.children].map((card) => card.dataset.providerCardKey);
      const desiredKeys = desiredPinned.map((card) => card.dataset.providerCardKey);
      const stable = currentKeys.length === desiredKeys.length && currentKeys.every((key, index) => key === desiredKeys[index]);
      if (!stable) desiredPinned.forEach((card) => holder.appendChild(card));
    } else {
      pinnedGroup()?.remove();
    }

    list.querySelectorAll(":scope > .provider-group:not(.pinned-provider-group)").forEach((group) => {
      const holder = group.querySelector(":scope > .provider-group-cards");
      group.hidden = !holder || !holder.querySelector("article.row");
    });
  }

  function scheduleCardSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      syncPinnedPlacement(settingsCache);
    });
  }

  async function togglePin(key, button) {
    const current = normalizePinnedCards(settingsCache && settingsCache.pinnedProviderCards);
    const exists = current.includes(key);
    const next = exists ? current.filter((item) => item !== key) : [...current, key].slice(0, MAX_PINNED_CARDS);
    if (button) button.disabled = true;
    try {
      const settings = await api.saveSettings({ pinnedProviderCards: next });
      rerenderWithSettings(settings);
    } catch (err) {
      if (button) button.disabled = false;
      const message = document.getElementById("connectionHubMessage");
      if (message) {
        message.textContent = err && err.message ? err.message : String(err);
        message.classList.add("warning");
      }
    }
  }

  function scheduleSettingsRefresh() {
    if (settingsRefreshTimer) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = setTimeout(async () => {
      settingsRefreshTimer = null;
      if (typeof api.getSettings !== "function") return;
      try {
        settingsCache = await api.getSettings();
        syncAutoHeightControl(settingsCache);
        scheduleCardSync();
      } catch {}
    }, 140);
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest(".card-pin-button[data-provider-pin]");
    if (!button || !list.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = cleanCardKey(button.dataset.providerPin);
    if (key) togglePin(key, button);
  });

  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(scheduleCardSync)
    : null;
  observer?.observe(list, { childList: true, subtree: true });

  if (typeof api.onUsage === "function") {
    api.onUsage((payload) => {
      usagePayload = payload;
      settingsCache = payload && payload.settings ? payload.settings : settingsCache;
      syncAutoHeightControl(settingsCache);
      scheduleCardSync();
    });
  }

  window.addEventListener("resize", scheduleSettingsRefresh);
  window.addEventListener("beforeunload", () => {
    observer?.disconnect();
    if (settingsRefreshTimer) clearTimeout(settingsRefreshTimer);
  }, { once: true });

  installStyle();
  installAutoHeightSetting();
  if (typeof api.getSettings === "function") {
    api.getSettings().then((settings) => {
      settingsCache = settings || {};
      syncAutoHeightControl(settingsCache);
      scheduleCardSync();
    }).catch(() => scheduleCardSync());
  } else {
    scheduleCardSync();
  }
})();
