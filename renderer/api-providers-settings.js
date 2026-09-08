const apiProvidersStyle = document.createElement("link");
apiProvidersStyle.rel = "stylesheet";
apiProvidersStyle.href = "api-providers-settings.css";
document.head.appendChild(apiProvidersStyle);

(function installApiProviderSettings() {
  const list = document.getElementById("apiProviderList");
  const api = window.tokenWidget;
  if (!list || !api || typeof api.getApiProviderCatalog !== "function") return;

  let catalog = [];
  try {
    catalog = api.getApiProviderCatalog() || [];
  } catch {
    catalog = [];
  }
  if (!catalog.length) return;

  const messageTimers = new WeakMap();

  function setCardMessage(card, text, warning = false) {
    const element = card.querySelector("[data-api-message]");
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("warning", warning);
    const previous = messageTimers.get(element);
    if (previous) clearTimeout(previous);
    if (text && !warning) {
      messageTimers.set(element, setTimeout(() => {
        if (element.textContent === text) element.textContent = "";
      }, 7000));
    }
  }

  function fieldInputs(card) {
    return [...card.querySelectorAll("input[data-api-field]")];
  }

  function makeCard(provider) {
    const card = document.createElement("div");
    card.className = "api-provider-card";
    card.dataset.apiProvider = provider.id;

    const head = document.createElement("div");
    head.className = "api-provider-head";
    const copy = document.createElement("div");
    copy.className = "api-provider-copy";
    const title = document.createElement("b");
    title.textContent = provider.name;
    const detail = document.createElement("small");
    detail.textContent = provider.detail || "";
    copy.append(title, detail);
    const status = document.createElement("span");
    status.className = "api-provider-status missing";
    status.dataset.apiStatus = provider.id;
    status.textContent = "미설정";
    head.append(copy, status);
    card.appendChild(head);

    (provider.credentials || []).forEach((cred) => {
      const label = document.createElement("label");
      label.className = "field";
      const span = document.createElement("span");
      span.className = "field-label";
      span.textContent = cred.label || cred.key;
      const input = document.createElement("input");
      input.type = "password";
      input.className = "secret-input";
      input.dataset.apiField = cred.key;
      input.placeholder = cred.placeholder || cred.label || cred.key;
      input.autocomplete = "off";
      input.spellcheck = false;
      label.append(span, input);
      card.appendChild(label);
    });

    const actions = document.createElement("div");
    actions.className = "api-secret-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary compact-btn";
    save.textContent = "저장";
    save.addEventListener("click", () => runSave(provider, card, save));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn subtle-danger compact-btn";
    clear.textContent = "삭제";
    clear.addEventListener("click", () => runClear(provider, card, clear));
    actions.append(save, clear);
    card.appendChild(actions);

    const message = document.createElement("p");
    message.className = "api-provider-message";
    message.dataset.apiMessage = provider.id;
    message.setAttribute("aria-live", "polite");
    card.appendChild(message);

    return card;
  }

  async function runSave(provider, card, button) {
    const patch = {};
    fieldInputs(card).forEach((input) => {
      if (input.value.trim()) patch[input.dataset.apiField] = input.value.trim();
    });
    if (!Object.keys(patch).length) {
      setCardMessage(card, "저장할 값을 입력하세요.", true);
      return;
    }
    button.disabled = true;
    setCardMessage(card, `${provider.name} 키를 저장하는 중...`);
    try {
      const settings = await api.saveApiProviderSecret(provider.id, patch);
      fieldInputs(card).forEach((input) => { input.value = ""; });
      applyStatuses(settings);
      setCardMessage(card, `${provider.name} 연결이 저장되었습니다.`);
      await api.refresh();
    } catch (err) {
      setCardMessage(card, (err && err.message) || String(err), true);
    } finally {
      button.disabled = false;
    }
  }

  async function runClear(provider, card, button) {
    button.disabled = true;
    setCardMessage(card, `${provider.name} 키를 삭제하는 중...`);
    try {
      const settings = await api.clearApiProviderSecret(provider.id);
      fieldInputs(card).forEach((input) => { input.value = ""; });
      applyStatuses(settings);
      setCardMessage(card, `${provider.name} 키를 삭제했습니다.`);
      await api.refresh();
    } catch (err) {
      setCardMessage(card, (err && err.message) || String(err), true);
    } finally {
      button.disabled = false;
    }
  }

  function applyStatuses(settings) {
    const statuses = (settings && settings.apiProviderStatuses) || {};
    const secureAvailable = !settings || settings.secureStorageAvailable !== false;
    catalog.forEach((provider) => {
      const badge = list.querySelector(`[data-api-status="${provider.id}"]`);
      if (!badge) return;
      const configured = statuses[provider.id] || {};
      const savedCount = (provider.credentials || []).filter((cred) => configured[cred.key]).length;
      const total = (provider.credentials || []).length;
      if (savedCount >= total && total > 0) {
        badge.className = "api-provider-status connected";
        badge.textContent = "저장됨";
      } else if (savedCount > 0) {
        badge.className = "api-provider-status attention";
        badge.textContent = "일부 저장";
      } else {
        badge.className = "api-provider-status missing";
        badge.textContent = secureAvailable ? "미설정" : "보안 저장소 불가";
      }
    });
  }

  const grid = document.createElement("div");
  grid.className = "api-provider-grid";
  catalog.forEach((provider) => grid.appendChild(makeCard(provider)));
  list.appendChild(grid);

  api.getSettings().then(applyStatuses).catch(() => {});
})();
