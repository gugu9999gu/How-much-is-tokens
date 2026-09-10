(() => {
  const legacyEditor = document.querySelector(".openrouter-profile-editor");
  const parent = legacyEditor && legacyEditor.parentElement;
  if (!legacyEditor || !parent || document.getElementById("openRouterQuickManager")) return;

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "openrouter-profile-ui.css";
  document.head.appendChild(style);

  const profileSelect = document.getElementById("openRouterProfileSelect");
  const apiKeyInput = document.getElementById("openRouterApiKey");
  const managementKeyInput = document.getElementById("openRouterManagementKey");
  const apiKeyField = apiKeyInput && apiKeyInput.closest(".field");
  const managementKeyField = managementKeyInput && managementKeyInput.closest(".field");
  const secretActions = document.getElementById("saveOpenRouterKeys")?.parentElement;
  const profilesTextarea = document.getElementById("openRouterProfiles");

  const manager = document.createElement("div");
  manager.id = "openRouterQuickManager";
  manager.className = "openrouter-quick-manager";
  manager.innerHTML = `
    <div class="openrouter-quick-head">
      <div>
        <b>계정 · API Key</b>
        <small>키를 추가하면 사용량 추적과 localhost 라우팅에 바로 포함됩니다.</small>
      </div>
      <div class="openrouter-quick-actions">
        <button type="button" class="btn primary" id="openRouterAddKey">+ API Key</button>
        <button type="button" class="btn" id="openRouterAddOAuth">+ 로그인</button>
      </div>
    </div>
    <div id="openRouterAddKeyPanel" class="openrouter-add-panel hidden" aria-hidden="true">
      <label class="field">
        <span class="field-label">표시 이름 <em>선택</em></span>
        <input type="text" id="openRouterNewLabel" maxlength="48" placeholder="예: 개인, 업무, 백업" autocomplete="off" />
      </label>
      <label class="field">
        <span class="field-label">OpenRouter API Key</span>
        <input class="secret-input" type="password" id="openRouterNewApiKey" placeholder="추적할 API Key" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span class="field-label">Management Key <em>선택</em></span>
        <input class="secret-input" type="password" id="openRouterNewManagementKey" placeholder="총 충전 크레딧 조회가 필요할 때만" autocomplete="off" spellcheck="false" />
      </label>
      <div class="openrouter-add-actions">
        <button type="button" class="btn primary" id="openRouterConfirmAddKey">추가하고 추적</button>
        <button type="button" class="btn" id="openRouterCancelAddKey">취소</button>
      </div>
    </div>
    <div id="openRouterProfileCards" class="openrouter-profile-cards" aria-live="polite"></div>
    <p id="openRouterQuickStatus" class="security-note openrouter-quick-status"></p>
  `;
  parent.insertBefore(manager, legacyEditor);

  const advanced = document.createElement("details");
  advanced.className = "openrouter-advanced-details";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "고급 프로필/키 편집";
  advanced.appendChild(advancedSummary);
  parent.insertBefore(advanced, legacyEditor);
  advanced.appendChild(legacyEditor);
  if (apiKeyField) advanced.appendChild(apiKeyField);
  if (managementKeyField) advanced.appendChild(managementKeyField);
  if (secretActions) advanced.appendChild(secretActions);

  const addKeyButton = document.getElementById("openRouterAddKey");
  const addOAuthButton = document.getElementById("openRouterAddOAuth");
  const addPanel = document.getElementById("openRouterAddKeyPanel");
  const newLabelInput = document.getElementById("openRouterNewLabel");
  const newApiKeyInput = document.getElementById("openRouterNewApiKey");
  const newManagementKeyInput = document.getElementById("openRouterNewManagementKey");
  const confirmAddButton = document.getElementById("openRouterConfirmAddKey");
  const cancelAddButton = document.getElementById("openRouterCancelAddKey");
  const cardsEl = document.getElementById("openRouterProfileCards");
  const statusEl = document.getElementById("openRouterQuickStatus");

  let lastSettings = null;
  let busy = false;

  function formatProfiles(profiles) {
    return (Array.isArray(profiles) ? profiles : []).map((profile) =>
      `${profile.id}|${profile.label || profile.id}|${Number(profile.priority) || 0}|${profile.enabled === false ? "off" : "on"}`,
    ).join("\n");
  }

  function secureStatusMap(settings = {}) {
    return new Map((Array.isArray(settings.openRouterProfileStatuses) ? settings.openRouterProfileStatuses : [])
      .map((item) => [item.id, item]));
  }

  function usageMap() {
    const payload = window.tokenWidget.getLastUsage?.();
    const rows = Array.isArray(payload && payload.providers) ? payload.providers : [];
    return new Map(rows
      .filter((row) => row && row.providerId === "openrouter" && row.profileId)
      .map((row) => [row.profileId, row]));
  }

  function setStatus(message = "", warning = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("warning", warning);
  }

  function toggleAddPanel(show) {
    const visible = show === true;
    addPanel.classList.toggle("hidden", !visible);
    addPanel.setAttribute("aria-hidden", visible ? "false" : "true");
    addKeyButton.setAttribute("aria-expanded", visible ? "true" : "false");
    if (visible) setTimeout(() => newLabelInput.focus(), 0);
    else {
      newLabelInput.value = "";
      newApiKeyInput.value = "";
      newManagementKeyInput.value = "";
    }
  }

  function syncLegacyControls(settings = {}) {
    const profiles = Array.isArray(settings.openRouterProfiles) ? settings.openRouterProfiles : [];
    if (profilesTextarea && document.activeElement !== profilesTextarea) {
      profilesTextarea.value = formatProfiles(profiles);
    }
    if (!profileSelect) return;
    const previous = profileSelect.value;
    profileSelect.replaceChildren();
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.label || profile.id} · 우선순위 ${profile.priority}`;
      profileSelect.appendChild(option);
    }
    if (profiles.some((profile) => profile.id === previous)) profileSelect.value = previous;
    else if (profiles.length) profileSelect.value = profiles[0].id;
  }

  function quotaCopy(row) {
    if (!row) return "아직 사용량을 확인하지 않음";
    const remaining = Number(row.routingRemainingPct ?? row.remainingPct);
    if (Number.isFinite(remaining)) return `${Math.max(0, Math.min(100, remaining)).toFixed(1)}% 남음`;
    if (row.status === "error") return "사용량 조회 실패";
    if (row.status === "missing") return "키 확인 필요";
    return "사용량 확인 중";
  }

  function makeBadge(text, className = "") {
    const badge = document.createElement("span");
    badge.className = `openrouter-profile-badge ${className}`.trim();
    badge.textContent = text;
    return badge;
  }

  async function saveProfiles(profiles, message) {
    const settings = await window.tokenWidget.saveSettings({ openRouterProfiles: profiles });
    await window.tokenWidget.configureOpenRouterRouter();
    applySettings(settings, message);
    window.tokenWidget.refresh();
    return settings;
  }

  function profileCard(profile, index, profiles, secureMap, usageByProfile) {
    const secure = secureMap.get(profile.id) || {};
    const usage = usageByProfile.get(profile.id);
    const card = document.createElement("article");
    card.className = "openrouter-profile-card";
    card.dataset.profileId = profile.id;

    const head = document.createElement("div");
    head.className = "openrouter-profile-card-head";
    const title = document.createElement("div");
    title.className = "openrouter-profile-title";
    const strong = document.createElement("strong");
    strong.textContent = profile.label || profile.id;
    const meta = document.createElement("small");
    meta.textContent = `#${index + 1} · ${profile.id}`;
    title.append(strong, meta);

    const enabled = document.createElement("label");
    enabled.className = "openrouter-mini-toggle";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = profile.enabled !== false;
    const enabledText = document.createElement("span");
    enabledText.textContent = "추적";
    enabled.append(enabledInput, enabledText);
    head.append(title, enabled);

    const detail = document.createElement("div");
    detail.className = "openrouter-profile-detail";
    const quota = document.createElement("b");
    quota.textContent = quotaCopy(usage);
    detail.appendChild(quota);
    if (secure.apiKeyConfigured) detail.appendChild(makeBadge("API Key", "ok"));
    else detail.appendChild(makeBadge("API Key 없음", "warn"));
    if (secure.managementKeyConfigured) detail.appendChild(makeBadge("크레딧 조회"));

    const actions = document.createElement("div");
    actions.className = "openrouter-card-actions";
    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn";
    up.textContent = "↑";
    up.title = "우선순위 올리기";
    up.disabled = index === 0;
    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn";
    down.textContent = "↓";
    down.title = "우선순위 내리기";
    down.disabled = index === profiles.length - 1;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn";
    edit.textContent = "키 편집";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn subtle-danger";
    remove.textContent = "삭제";
    actions.append(up, down, edit, remove);

    enabledInput.addEventListener("change", async () => {
      enabledInput.disabled = true;
      try {
        const next = profiles.map((item) => item.id === profile.id ? { ...item, enabled: enabledInput.checked } : item);
        await saveProfiles(next, `${profile.label || profile.id} ${enabledInput.checked ? "추적을 활성화" : "추적을 일시 중지"}했습니다.`);
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        enabledInput.disabled = false;
      }
    });

    async function move(delta) {
      if (busy) return;
      const target = index + delta;
      if (target < 0 || target >= profiles.length) return;
      busy = true;
      try {
        const reordered = [...profiles];
        const [row] = reordered.splice(index, 1);
        reordered.splice(target, 0, row);
        const reprioritized = reordered.map((item, order) => ({ ...item, priority: (order + 1) * 10 }));
        await saveProfiles(reprioritized, `${profile.label || profile.id} 우선순위를 변경했습니다.`);
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        busy = false;
      }
    }
    up.addEventListener("click", () => move(-1));
    down.addEventListener("click", () => move(1));

    edit.addEventListener("click", () => {
      if (profileSelect) {
        profileSelect.value = profile.id;
        profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      advanced.open = true;
      setStatus(`${profile.label || profile.id}의 저장된 키를 교체하거나 고급 프로필 값을 편집할 수 있습니다.`);
      advanced.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    remove.addEventListener("click", async () => {
      if (busy) return;
      if (!window.confirm(`OpenRouter '${profile.label || profile.id}' 프로필과 저장된 키를 삭제할까요?`)) return;
      busy = true;
      remove.disabled = true;
      try {
        const result = await window.tokenWidget.deleteOpenRouterProfile(profile.id);
        if (!result || result.ok !== true) throw new Error(result?.reason || "프로필을 삭제하지 못했습니다.");
        applySettings(result.settings || await window.tokenWidget.getSettings(), `${profile.label || profile.id} 프로필을 삭제했습니다.`);
        window.tokenWidget.refresh();
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        busy = false;
        remove.disabled = false;
      }
    });

    card.append(head, detail, actions);
    return card;
  }

  function render(settings = {}) {
    lastSettings = settings;
    syncLegacyControls(settings);
    const profiles = Array.isArray(settings.openRouterProfiles) ? settings.openRouterProfiles : [];
    const secureMap = secureStatusMap(settings);
    const usageByProfile = usageMap();
    cardsEl.replaceChildren();

    if (!profiles.length) {
      const empty = document.createElement("div");
      empty.className = "openrouter-profile-empty";
      empty.innerHTML = "<b>추적 중인 OpenRouter 키가 없습니다.</b><small>API Key를 직접 추가하거나 OpenRouter 로그인으로 연결하세요.</small>";
      cardsEl.appendChild(empty);
    } else {
      profiles.forEach((profile, index) => cardsEl.appendChild(profileCard(profile, index, profiles, secureMap, usageByProfile)));
    }

    const secureAvailable = settings.secureStorageAvailable === true;
    addKeyButton.disabled = !secureAvailable || profiles.length >= 16;
    addOAuthButton.disabled = !secureAvailable || profiles.length >= 16;
    if (!secureAvailable) setStatus("운영체제 보안 저장소를 사용할 수 없어 새 키를 추가할 수 없습니다.", true);
  }

  function applySettings(settings, message = "") {
    render(settings || {});
    if (message) setStatus(message, false);
  }

  async function refresh(message = "") {
    try {
      const settings = await window.tokenWidget.getSettings();
      applySettings(settings, message);
      return settings;
    } catch (err) {
      setStatus(err.message || String(err), true);
      return null;
    }
  }

  addKeyButton.addEventListener("click", () => toggleAddPanel(addPanel.classList.contains("hidden")));
  cancelAddButton.addEventListener("click", () => toggleAddPanel(false));

  confirmAddButton.addEventListener("click", async () => {
    if (busy) return;
    const apiKey = newApiKeyInput.value.trim();
    if (!apiKey) {
      setStatus("추적할 OpenRouter API Key를 입력하세요.", true);
      newApiKeyInput.focus();
      return;
    }
    busy = true;
    confirmAddButton.disabled = true;
    try {
      const result = await window.tokenWidget.createOpenRouterTrackedProfile({
        label: newLabelInput.value.trim(),
        apiKey,
        managementKey: newManagementKeyInput.value.trim(),
      });
      if (!result || result.ok !== true) {
        throw new Error(result?.error || result?.reason || "API Key를 추가하지 못했습니다.");
      }
      toggleAddPanel(false);
      applySettings(result.settings || await window.tokenWidget.getSettings(), `${result.accountLabel || "OpenRouter"} API Key를 추가하고 추적을 시작했습니다.`);
      window.tokenWidget.refresh();
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      busy = false;
      confirmAddButton.disabled = false;
    }
  });

  addOAuthButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    addOAuthButton.disabled = true;
    const original = addOAuthButton.textContent;
    addOAuthButton.textContent = "로그인 대기…";
    setStatus("브라우저에서 OpenRouter 로그인을 완료하세요.");
    try {
      const result = await window.tokenWidget.addCredentialAccount("openrouter");
      if (!result || result.ok !== true) {
        throw new Error(result?.error || result?.reason || "OpenRouter 로그인을 완료하지 못했습니다.");
      }
      await refresh(`${result.accountLabel || "OpenRouter"} 계정을 연결했습니다.`);
      window.tokenWidget.refresh();
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      busy = false;
      addOAuthButton.textContent = original;
      addOAuthButton.disabled = !(lastSettings?.secureStorageAvailable === true) || (lastSettings?.openRouterProfiles?.length || 0) >= 16;
    }
  });

  for (const id of ["saveOpenRouterProfiles", "saveOpenRouterKeys", "clearOpenRouterKeys"]) {
    const element = document.getElementById(id);
    element?.addEventListener("click", () => setTimeout(() => refresh(), 300));
  }

  window.tokenWidget.onUsage?.(() => {
    if (lastSettings) render(lastSettings);
  });

  refresh().catch(() => {});
})();
