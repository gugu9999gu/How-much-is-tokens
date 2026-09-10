const apiProvidersStyle = document.createElement("link");
apiProvidersStyle.rel = "stylesheet";
apiProvidersStyle.href = "api-providers-settings.css";
document.head.appendChild(apiProvidersStyle);

(function installApiProviderSettings() {
  const list = document.getElementById("apiProviderList");
  const api = window.tokenWidget;
  if (!list || !api || typeof api.getApiProviderCatalog !== "function") return;

  let catalog = [];
  let currentSettings = {};
  try { catalog = api.getApiProviderCatalog() || []; } catch { catalog = []; }
  if (!catalog.length) return;

  const messageTimers = new WeakMap();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

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

  function fieldInputs(root) {
    return [...root.querySelectorAll("input[data-api-field]")];
  }

  function providerProfiles(providerId, settings = currentSettings) {
    return (Array.isArray(settings.mediaProviderProfiles) ? settings.mediaProviderProfiles : [])
      .filter((profile) => profile.providerId === providerId);
  }

  function profileStatus(providerId, profileId, settings = currentSettings) {
    return (Array.isArray(settings.mediaProviderProfileStatuses) ? settings.mediaProviderProfileStatuses : [])
      .find((row) => row.providerId === providerId && row.id === profileId) || { fields: {}, mcpAuthorized: false };
  }

  function usageFor(providerId, profileId) {
    const payload = typeof api.getLastUsage === "function" ? api.getLastUsage() : null;
    const rows = Array.isArray(payload && payload.providers) ? payload.providers : [];
    return rows.find((row) => row && row.providerId === providerId && row.profileId === profileId) || null;
  }

  function usageCopy(row) {
    if (!row) return "새로고침 후 잔여량 표시";
    const balances = Array.isArray(row.creditBalances) ? row.creditBalances : [];
    const first = balances[0];
    if (first && Number.isFinite(Number(first.balance))) {
      const value = Number(first.balance);
      if (first.currency) return `${value.toFixed(2)} ${first.currency}`;
      if (first.unit) return `${value.toLocaleString()} ${first.unit}`;
      return String(value);
    }
    if (Number.isFinite(Number(row.remainingPct))) return `${Number(row.remainingPct).toFixed(1)}% 남음`;
    if (row.status === "login") return "재연결 필요";
    if (row.status === "error") return "조회 오류";
    return row.status === "ok" ? "연결됨" : "잔여량 확인 전";
  }

  function credentialFields(provider, root, values = {}) {
    for (const cred of provider.credentials || []) {
      const label = el("label", "field compact-field");
      label.appendChild(el("span", "field-label", cred.label || cred.key));
      const input = el("input", "secret-input");
      input.type = "password";
      input.dataset.apiField = cred.key;
      input.placeholder = values[cred.key] || cred.placeholder || cred.label || cred.key;
      input.autocomplete = "off";
      input.spellcheck = false;
      label.appendChild(input);
      root.appendChild(label);
    }
  }

  function closeAccountEditor(card) {
    const existing = card.querySelector("[data-media-account-editor]");
    if (existing) existing.remove();
  }

  function showAccountEditor(provider, card, mode, profile = null) {
    closeAccountEditor(card);
    const editor = el("div", "media-account-editor");
    editor.dataset.mediaAccountEditor = "1";
    const heading = el("div", "media-account-editor-head");
    heading.appendChild(el("b", "", profile ? `${profile.label} 편집` : (mode === "mcp" ? "MCP 계정 추가" : "API 계정 추가")));
    const close = el("button", "media-icon-btn", "×");
    close.type = "button";
    close.title = "닫기";
    close.onclick = () => editor.remove();
    heading.appendChild(close);
    editor.appendChild(heading);

    if (!profile) {
      const label = el("label", "field compact-field");
      label.appendChild(el("span", "field-label", "표시 이름"));
      const input = el("input", "media-text-input");
      input.dataset.mediaLabel = "1";
      input.placeholder = `${provider.name} 추가 계정`;
      input.maxLength = 56;
      label.appendChild(input);
      editor.appendChild(label);
    }

    const isOAuthMcp = mode === "mcp" && provider.mcp && provider.mcp.auth === "oauth";
    if (!isOAuthMcp) credentialFields(provider, editor);
    if (mode === "mcp") {
      const endpoint = provider.mcp && provider.mcp.url ? provider.mcp.url : "";
      editor.appendChild(el("p", "media-mcp-note", isOAuthMcp
        ? `공식 MCP · 브라우저 OAuth로 연결${endpoint ? ` · ${endpoint}` : ""}`
        : `공식 MCP · 저장한 API Key로 연결${endpoint ? ` · ${endpoint}` : ""}`));
    }

    const actions = el("div", "api-secret-actions media-editor-actions");
    const submit = el("button", "btn primary compact-btn", profile ? (isOAuthMcp ? "MCP 재연결" : "키 교체") : (isOAuthMcp ? "브라우저에서 연결" : "추가하고 추적"));
    submit.type = "button";
    const cancel = el("button", "btn compact-btn", "취소");
    cancel.type = "button";
    cancel.onclick = () => editor.remove();
    submit.onclick = async () => {
      submit.disabled = true;
      try {
        let result;
        if (profile && isOAuthMcp) {
          result = await api.connectMediaProviderMcp(provider.id, { createNew: false, profileId: profile.id });
        } else if (profile) {
          const patch = {};
          fieldInputs(editor).forEach((input) => { if (input.value.trim()) patch[input.dataset.apiField] = input.value.trim(); });
          if (!Object.keys(patch).length) throw new Error("교체할 키를 입력하세요.");
          result = await api.saveMediaProviderAccountCredentials(provider.id, profile.id, patch);
        } else {
          const labelInput = editor.querySelector("[data-media-label]");
          const label = labelInput ? labelInput.value.trim() : "";
          if (isOAuthMcp) {
            result = await api.connectMediaProviderMcp(provider.id, { createNew: true, label });
          } else {
            const credentials = {};
            fieldInputs(editor).forEach((input) => { if (input.value.trim()) credentials[input.dataset.apiField] = input.value.trim(); });
            result = await api.addMediaProviderAccount(provider.id, { label, mode, credentials });
          }
        }
        if (!result || !result.ok) {
          const copy = result && result.reason === "duplicate-account"
            ? `이미 등록된 연결입니다${result.accountLabel ? ` · ${result.accountLabel}` : ""}.`
            : (result && result.error) || "계정을 추가하지 못했습니다.";
          throw new Error(copy);
        }
        currentSettings = result.settings || await api.getSettings();
        editor.remove();
        renderProfiles(provider, card);
        applyStatuses(currentSettings);
        setCardMessage(card, `${result.accountLabel || provider.name} 연결을 저장했습니다.`);
        await api.refresh();
      } catch (err) {
        setCardMessage(card, (err && err.message) || String(err), true);
      } finally {
        submit.disabled = false;
      }
    };
    actions.append(submit, cancel);
    editor.appendChild(actions);
    const anchor = card.querySelector("[data-media-profile-list]");
    if (anchor) anchor.before(editor); else card.appendChild(editor);
    editor.querySelector("input")?.focus();
  }

  async function toggleProfile(provider, card, profile, enabled) {
    const result = await api.updateMediaProviderAccount(provider.id, profile.id, { enabled });
    if (!result || !result.ok) throw new Error((result && result.error) || "추적 상태를 변경하지 못했습니다.");
    currentSettings = result.settings || await api.getSettings();
    renderProfiles(provider, card);
    applyStatuses(currentSettings);
    await api.refresh();
  }

  async function removeProfile(provider, card, profile) {
    if (!window.confirm(`${profile.label} 연결을 삭제할까요? 저장된 자격증명도 함께 제거됩니다.`)) return;
    const result = await api.removeMediaProviderAccount(provider.id, profile.id);
    if (!result || !result.ok) throw new Error((result && result.error) || "계정을 삭제하지 못했습니다.");
    currentSettings = result.settings || await api.getSettings();
    renderProfiles(provider, card);
    applyStatuses(currentSettings);
    setCardMessage(card, `${profile.label} 연결을 삭제했습니다.`);
    await api.refresh();
  }

  function renderProfiles(provider, card) {
    const host = card.querySelector("[data-media-profile-list]");
    if (!host) return;
    host.replaceChildren();
    const profiles = providerProfiles(provider.id);
    if (!profiles.length) {
      host.appendChild(el("p", "media-empty", "추가 계정 없음 · 필요하면 API Key 또는 MCP 계정을 추가하세요."));
      return;
    }
    profiles.forEach((profile) => {
      const status = profileStatus(provider.id, profile.id);
      const usage = usageFor(provider.id, profile.id);
      const item = el("div", "media-account-row");
      item.dataset.mediaProfileId = profile.id;
      const main = el("div", "media-account-main");
      const titleRow = el("div", "media-account-title");
      titleRow.appendChild(el("b", "", profile.label));
      titleRow.appendChild(el("span", `media-mode-badge ${profile.mode}`, profile.mode === "mcp" ? "MCP" : "API"));
      const balance = el("span", "media-account-balance", usageCopy(usage));
      balance.dataset.mediaBalance = `${provider.id}:${profile.id}`;
      main.append(titleRow, balance);
      const meta = el("div", "media-account-meta");
      if (profile.mode === "mcp") {
        meta.textContent = status.mcpAuthorized || (provider.mcp && provider.mcp.auth === "bearer-api-key") ? "MCP 인증 저장됨" : "MCP 인증 필요";
      } else {
        const count = Object.values(status.fields || {}).filter(Boolean).length;
        meta.textContent = count ? `API 자격증명 ${count}개 저장됨` : "API 자격증명 확인 필요";
      }
      main.appendChild(meta);
      item.appendChild(main);

      const controls = el("div", "media-account-controls");
      const toggle = el("label", "media-mini-toggle");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = profile.enabled !== false;
      checkbox.setAttribute("aria-label", `${profile.label} 추적`);
      checkbox.onchange = async () => {
        checkbox.disabled = true;
        try { await toggleProfile(provider, card, profile, checkbox.checked); }
        catch (err) { setCardMessage(card, (err && err.message) || String(err), true); checkbox.checked = !checkbox.checked; }
        finally { checkbox.disabled = false; }
      };
      toggle.append(checkbox, el("span", "", "추적"));
      const edit = el("button", "media-text-btn", profile.mode === "mcp" && provider.mcp && provider.mcp.auth === "oauth" ? "재연결" : "키 편집");
      edit.type = "button";
      edit.onclick = () => showAccountEditor(provider, card, profile.mode, profile);
      const remove = el("button", "media-text-btn danger", "삭제");
      remove.type = "button";
      remove.onclick = () => removeProfile(provider, card, profile).catch((err) => setCardMessage(card, (err && err.message) || String(err), true));
      controls.append(toggle, edit, remove);
      item.appendChild(controls);
      host.appendChild(item);
    });
  }

  function makeDefaultConnection(provider, card) {
    const details = el("details", "media-default-connection");
    const summary = el("summary", "", "기본 연결 · 기존 API Key");
    details.appendChild(summary);
    const body = el("div", "media-default-body");
    credentialFields(provider, body);
    const actions = el("div", "api-secret-actions");
    const save = el("button", "btn primary compact-btn", "기본 키 저장");
    save.type = "button";
    save.addEventListener("click", () => runSave(provider, card, body, save));
    const clear = el("button", "btn subtle-danger compact-btn", "기본 키 삭제");
    clear.type = "button";
    clear.addEventListener("click", () => runClear(provider, card, body, clear));
    actions.append(save, clear);
    body.appendChild(actions);
    details.appendChild(body);
    return details;
  }

  function makeCard(provider) {
    const card = el("div", "api-provider-card");
    card.dataset.apiProvider = provider.id;
    const head = el("div", "api-provider-head");
    const copy = el("div", "api-provider-copy");
    copy.append(el("b", "", provider.name), el("small", "", provider.detail || ""));
    const status = el("span", "api-provider-status missing", "미설정");
    status.dataset.apiStatus = provider.id;
    head.append(copy, status);
    card.appendChild(head);

    const toolbar = el("div", "media-provider-toolbar");
    const addApi = el("button", "btn primary compact-btn", "+ API 계정");
    addApi.type = "button";
    addApi.onclick = () => showAccountEditor(provider, card, "api");
    toolbar.appendChild(addApi);
    if (provider.mcp && provider.mcp.available) {
      const addMcp = el("button", "btn compact-btn media-mcp-btn", provider.mcp.auth === "oauth" ? "+ MCP 계정" : "+ MCP 키");
      addMcp.type = "button";
      addMcp.onclick = () => showAccountEditor(provider, card, "mcp");
      toolbar.appendChild(addMcp);
    } else {
      const note = el("span", "media-no-mcp", "공식 잔액 MCP 없음");
      toolbar.appendChild(note);
    }
    card.appendChild(toolbar);

    const profileList = el("div", "media-profile-list");
    profileList.dataset.mediaProfileList = provider.id;
    card.appendChild(profileList);
    card.appendChild(makeDefaultConnection(provider, card));

    const message = el("p", "api-provider-message");
    message.dataset.apiMessage = provider.id;
    message.setAttribute("aria-live", "polite");
    card.appendChild(message);
    return card;
  }

  async function runSave(provider, card, root, button) {
    const patch = {};
    fieldInputs(root).forEach((input) => { if (input.value.trim()) patch[input.dataset.apiField] = input.value.trim(); });
    if (!Object.keys(patch).length) { setCardMessage(card, "저장할 값을 입력하세요.", true); return; }
    button.disabled = true;
    try {
      currentSettings = await api.saveApiProviderSecret(provider.id, patch);
      fieldInputs(root).forEach((input) => { input.value = ""; });
      applyStatuses(currentSettings);
      setCardMessage(card, `${provider.name} 기본 연결을 저장했습니다.`);
      await api.refresh();
    } catch (err) { setCardMessage(card, (err && err.message) || String(err), true); }
    finally { button.disabled = false; }
  }

  async function runClear(provider, card, root, button) {
    button.disabled = true;
    try {
      currentSettings = await api.clearApiProviderSecret(provider.id);
      fieldInputs(root).forEach((input) => { input.value = ""; });
      applyStatuses(currentSettings);
      setCardMessage(card, `${provider.name} 기본 키를 삭제했습니다.`);
      await api.refresh();
    } catch (err) { setCardMessage(card, (err && err.message) || String(err), true); }
    finally { button.disabled = false; }
  }

  function applyStatuses(settings) {
    currentSettings = settings || currentSettings || {};
    const statuses = currentSettings.apiProviderStatuses || {};
    const secureAvailable = currentSettings.secureStorageAvailable !== false;
    catalog.forEach((provider) => {
      const card = list.querySelector(`[data-api-provider="${provider.id}"]`);
      const badge = card && card.querySelector(`[data-api-status="${provider.id}"]`);
      if (!card || !badge) return;
      const configured = statuses[provider.id] || {};
      const defaultConfigured = (provider.credentials || []).some((cred) => configured[cred.key]);
      const profiles = providerProfiles(provider.id, currentSettings);
      const active = profiles.filter((profile) => profile.enabled !== false).length;
      const totalConnections = (defaultConfigured ? 1 : 0) + active;
      if (totalConnections > 0) {
        badge.className = "api-provider-status connected";
        badge.textContent = `${totalConnections}개 추적`;
      } else {
        badge.className = "api-provider-status missing";
        badge.textContent = secureAvailable ? "미설정" : "보안 저장소 불가";
      }
      renderProfiles(provider, card);
    });
  }

  function updateUsageMetrics(payload) {
    const rows = Array.isArray(payload && payload.providers) ? payload.providers : [];
    for (const node of list.querySelectorAll("[data-media-balance]")) {
      const [providerId, profileId] = String(node.dataset.mediaBalance || "").split(":");
      const row = rows.find((item) => item && item.providerId === providerId && item.profileId === profileId);
      node.textContent = usageCopy(row);
    }
  }

  const grid = el("div", "api-provider-grid");
  catalog.forEach((provider) => grid.appendChild(makeCard(provider)));
  list.appendChild(grid);

  api.getSettings().then((settings) => {
    applyStatuses(settings);
    updateUsageMetrics(api.getLastUsage && api.getLastUsage());
  }).catch(() => {});
  if (typeof api.onUsage === "function") api.onUsage(updateUsageMetrics);
})();
