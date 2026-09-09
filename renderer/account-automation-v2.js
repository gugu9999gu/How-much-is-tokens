(() => {
  const api = window.tokenWidget;
  if (!api) return;

  const EXTRA_MULTI_ACCOUNT_PROVIDERS = [
    { id: "cursor", label: "Cursor" },
    { id: "copilot", label: "Copilot" },
    { id: "antigravity", label: "Antigravity" },
  ];
  const ROUTING_PROVIDERS = [
    { id: "codex", label: "Codex" },
    { id: "claude", label: "Claude" },
    { id: "grok", label: "Grok" },
    { id: "cursor", label: "Cursor" },
    { id: "copilot", label: "Copilot" },
    { id: "antigravity", label: "Antigravity" },
  ];
  const EXTRA_ROUTING_PROVIDERS = new Set(["cursor", "copilot", "antigravity"]);
  const PRESERVED_PROFILE_PROVIDERS = new Set(["cursor", "copilot"]);
  let latestSettings = null;
  let preserveTimer = null;
  let routingSaveTimer = null;

  function hubMessage(text, warning = false) {
    const element = document.getElementById("connectionHubMessage");
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("warning", warning);
  }

  function routingMessage(text, warning = false) {
    const element = document.getElementById("smartRoutingStatus");
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("warning", warning);
  }

  function accountProfileKey(profile) {
    return `${String(profile && profile.providerId || "").toLowerCase()}\0${String(profile && profile.configDir || "").toLowerCase()}`;
  }

  async function addManagedAccount(provider, button) {
    button.disabled = true;
    hubMessage(`${provider.label} 추가 계정을 준비하는 중...`);
    try {
      const result = await api.addCredentialAccount(provider.id);
      if (!result || !result.ok) {
        if (provider.id === "antigravity" && result && result.reason === "account-manager-required") {
          await syncAntigravityManager(true);
          hubMessage("Antigravity 다계정은 암호화 계정 도우미가 필요합니다. ‘계정 도우미 설치’ 후 다시 + 계정을 누르세요.", true);
          return;
        }
        hubMessage((result && (result.error || result.reason)) || `${provider.label} 계정 추가를 시작하지 못했습니다.`, true);
        return;
      }
      hubMessage(`${result.accountLabel || provider.label} 로그인 창을 열었습니다. 로그인 완료 후 상태를 새로고침하세요.`);
    } catch (err) {
      hubMessage(err.message || String(err), true);
    } finally {
      button.disabled = false;
    }
  }

  function ensureExtraAccountButtons() {
    for (const provider of EXTRA_MULTI_ACCOUNT_PROVIDERS) {
      const card = document.querySelector(`.connection-card[data-connection-provider="${provider.id}"]`);
      const actions = card && card.querySelector(".connection-actions");
      if (!actions || actions.querySelector(`[data-complete-account-add="${provider.id}"]`)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn subtle compact-btn";
      button.dataset.completeAccountAdd = provider.id;
      button.textContent = "+ 계정";
      button.title = `${provider.label} 추가 계정 로그인`;
      button.addEventListener("click", () => addManagedAccount(provider, button));
      actions.appendChild(button);
    }
  }

  async function syncAntigravityManager(forceMessage = false) {
    if (typeof api.getAntigravityAccountManagerStatus !== "function") return;
    const card = document.querySelector('.connection-card[data-connection-provider="antigravity"]');
    const actions = card && card.querySelector(".connection-actions");
    if (!actions) return;
    let status;
    try { status = await api.getAntigravityAccountManagerStatus(); } catch { return; }
    let install = actions.querySelector("[data-install-antigravity-manager]");
    if (status && status.installed) {
      if (install) install.remove();
      return;
    }
    if (!status || !status.goAvailable || typeof api.installAntigravityAccountManager !== "function") {
      if (install) install.remove();
      if (forceMessage && status && !status.goAvailable) {
        hubMessage("Antigravity 다계정 도우미 설치에는 Go가 필요합니다. 기존 agy 단일 계정은 그대로 사용할 수 있습니다.", true);
      }
      return;
    }
    if (install) return;
    install = document.createElement("button");
    install.type = "button";
    install.className = "btn subtle compact-btn";
    install.dataset.installAntigravityManager = "1";
    install.textContent = "계정 도우미 설치";
    install.title = "암호화 Antigravity 다계정 도우미 agm 설치";
    install.addEventListener("click", async () => {
      install.disabled = true;
      hubMessage("Antigravity 계정 도우미를 설치하는 중...");
      try {
        const result = await api.installAntigravityAccountManager();
        if (!result || !result.ok) throw new Error((result && (result.error || result.reason)) || "설치 실패");
        hubMessage("Antigravity 계정 도우미 설치를 완료했습니다. + 계정으로 Google 계정을 추가할 수 있습니다.");
        await syncAntigravityManager();
      } catch (err) {
        hubMessage(err.message || String(err), true);
      } finally {
        install.disabled = false;
      }
    });
    actions.appendChild(install);
  }

  function routeCard(provider) {
    const card = document.createElement("div");
    card.className = "smart-route-card";
    card.dataset.routeProvider = provider.id;
    card.innerHTML = `
      <label class="toggle">
        <span class="toggle-copy"><b>${provider.label}</b><small>새 CLI 실행 시 계정 자동 선택</small></span>
        <input type="checkbox" data-route-enabled="${provider.id}" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label class="field smart-route-field">
        <span class="field-label">선택 정책</span>
        <select data-route-policy="${provider.id}">
          <option value="priority-fallback">1번 소진 → 다음 계정</option>
          <option value="max-remaining">잔여량 가장 많은 계정</option>
          <option value="fixed-primary">기본 계정 고정</option>
        </select>
      </label>
      <label class="field smart-route-field">
        <span class="field-label">전환 기준</span>
        <div class="stepper"><input type="number" min="0" max="100" step="0.1" data-route-threshold="${provider.id}" /><span>% 이하</span></div>
      </label>
      <button type="button" class="btn primary smart-route-launch" data-complete-route-launch="${provider.id}">${provider.label} 스마트 실행</button>
    `;
    return card;
  }

  function routeConfig(settings, providerId) {
    const config = settings && settings.smartRouting && settings.smartRouting[providerId];
    return {
      enabled: !!(config && config.enabled === true),
      policy: config && ["fixed-primary", "priority-fallback", "max-remaining"].includes(config.policy)
        ? config.policy : "priority-fallback",
      thresholdPct: Number.isFinite(Number(config && config.thresholdPct)) ? Number(config.thresholdPct) : 0,
    };
  }

  function applyRouting(settings = {}) {
    for (const provider of ROUTING_PROVIDERS) {
      const config = routeConfig(settings, provider.id);
      const enabled = document.querySelector(`[data-route-enabled="${provider.id}"]`);
      const policy = document.querySelector(`[data-route-policy="${provider.id}"]`);
      const threshold = document.querySelector(`[data-route-threshold="${provider.id}"]`);
      if (enabled) enabled.checked = config.enabled;
      if (policy) policy.value = config.policy;
      if (threshold) threshold.value = config.thresholdPct;
    }
  }

  function collectRouting(settings = {}) {
    const result = { ...(settings.smartRouting || {}) };
    for (const provider of ROUTING_PROVIDERS) {
      const enabled = document.querySelector(`[data-route-enabled="${provider.id}"]`);
      const policy = document.querySelector(`[data-route-policy="${provider.id}"]`);
      const threshold = document.querySelector(`[data-route-threshold="${provider.id}"]`);
      if (!enabled || !policy || !threshold) continue;
      result[provider.id] = {
        enabled: !!enabled.checked,
        policy: policy.value,
        thresholdPct: Number(threshold.value) || 0,
      };
    }
    return result;
  }

  async function saveAllRouting(delay = 0) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const current = await api.getSettings();
    const settings = await api.saveSettings({ smartRouting: collectRouting(current) });
    latestSettings = settings;
    applyRouting(settings);
    return settings;
  }

  function ensureExtraRoutingCards() {
    const list = document.querySelector("#smartRoutingGroup .smart-route-list");
    if (!list) return;
    for (const provider of ROUTING_PROVIDERS.filter((item) => EXTRA_ROUTING_PROVIDERS.has(item.id))) {
      if (!list.querySelector(`[data-route-provider="${provider.id}"]`)) list.appendChild(routeCard(provider));
    }

    list.querySelectorAll("[data-route-enabled], [data-route-policy], [data-route-threshold]").forEach((element) => {
      if (element.dataset.completeRouteBound === "1") return;
      element.dataset.completeRouteBound = "1";
      element.addEventListener("change", () => {
        if (routingSaveTimer) clearTimeout(routingSaveTimer);
        // Existing v1 UI saves only the legacy three providers. Run after it so
        // the complete six-provider state wins deterministically.
        routingSaveTimer = setTimeout(() => {
          saveAllRouting().then(() => routingMessage("Smart Routing 정책을 저장했습니다."))
            .catch((err) => routingMessage(err.message || String(err), true));
        }, 80);
      });
    });

    list.querySelectorAll("[data-complete-route-launch]").forEach((button) => {
      if (button.dataset.completeLaunchBound === "1") return;
      button.dataset.completeLaunchBound = "1";
      button.addEventListener("click", async () => {
        const providerId = button.dataset.completeRouteLaunch;
        button.disabled = true;
        try {
          await saveAllRouting();
          routingMessage(`${providerId} 사용량을 새로 확인하고 계정을 선택하는 중...`);
          const result = await api.routeLaunch(providerId);
          if (!result || !result.ok) {
            const copy = {
              disabled: "Smart Routing이 꺼져 있습니다.",
              "no-accounts": "등록된 계정을 찾지 못했습니다.",
              "no-usable-account": "최신 사용량 기준으로 실행 가능한 계정이 없습니다.",
              "account-manager-required": "Antigravity 계정 도우미가 필요합니다.",
              "account-switch-failed": "Antigravity 계정 전환에 실패했습니다.",
            }[result && result.reason];
            throw new Error(copy || (result && (result.error || result.reason)) || "라우팅 실패");
          }
          const pct = Number.isFinite(Number(result.remainingPct)) ? ` · 잔여 ${Number(result.remainingPct).toFixed(1)}%` : "";
          routingMessage(`${providerId} → ${result.accountLabel || "계정"}${pct} · 새 CLI를 실행했습니다.`);
        } catch (err) {
          routingMessage(err.message || String(err), true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function saveCodexProfileReset(profileId, enabled) {
    const settings = await api.getSettings();
    const selected = new Set(Array.isArray(settings.codexAutoResetProfiles) ? settings.codexAutoResetProfiles : []);
    if (enabled) selected.add(profileId); else selected.delete(profileId);
    latestSettings = await api.saveSettings({ codexAutoResetProfiles: [...selected] });
    renderCodexProfileReset(latestSettings);
  }

  function renderCodexProfileReset(settings = {}) {
    const automationGroup = document.getElementById("codexAutoUseReset")?.closest(".set-group");
    if (!automationGroup) return;
    const profiles = (Array.isArray(settings.accountProfiles) ? settings.accountProfiles : [])
      .filter((profile) => profile && profile.providerId === "codex" && profile.enabled !== false);
    let wrap = document.getElementById("codexProfileResetOptions");
    if (!profiles.length) {
      if (wrap) wrap.remove();
      return;
    }
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "codexProfileResetOptions";
      wrap.className = "codex-profile-reset-options";
      const note = document.createElement("p");
      note.className = "security-note";
      note.textContent = "추가 Codex 계정은 계정별로 명시적으로 켠 경우에만 banked reset 티켓을 자동 사용합니다.";
      wrap.appendChild(note);
      automationGroup.appendChild(wrap);
    }
    [...wrap.querySelectorAll("label.toggle")].forEach((node) => node.remove());
    const enabledIds = new Set(Array.isArray(settings.codexAutoResetProfiles) ? settings.codexAutoResetProfiles : []);
    for (const profile of profiles) {
      const label = document.createElement("label");
      label.className = "toggle";
      const copy = document.createElement("span");
      copy.className = "toggle-copy";
      copy.innerHTML = `<b>${profile.label}</b><small>이 계정의 실제 rate-limit 도달 시 reset 티켓 자동 사용</small>`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.codexProfileReset = profile.id;
      input.checked = enabledIds.has(profile.id);
      const sw = document.createElement("span");
      sw.className = "switch";
      sw.setAttribute("aria-hidden", "true");
      input.addEventListener("change", async () => {
        input.disabled = true;
        try { await saveCodexProfileReset(profile.id, input.checked); }
        catch (err) { hubMessage(err.message || String(err), true); }
        finally { input.disabled = false; }
      });
      label.append(copy, input, sw);
      wrap.appendChild(label);
    }
  }

  function preservedProfiles(settings = {}) {
    return (Array.isArray(settings.accountProfiles) ? settings.accountProfiles : [])
      .filter((profile) => PRESERVED_PROFILE_PROVIDERS.has(String(profile && profile.providerId || "").toLowerCase()));
  }

  function installSavePreservation() {
    const save = document.getElementById("saveBtn");
    if (!save || save.dataset.completeProfilePreserve === "1") return;
    save.dataset.completeProfilePreserve = "1";
    save.addEventListener("click", () => {
      const keep = preservedProfiles(latestSettings || {});
      if (!keep.length) return;
      if (preserveTimer) clearTimeout(preserveTimer);
      preserveTimer = setTimeout(async () => {
        try {
          const current = await api.getSettings();
          const profiles = Array.isArray(current.accountProfiles) ? current.accountProfiles : [];
          const seen = new Set(profiles.map(accountProfileKey));
          const missing = keep.filter((profile) => !seen.has(accountProfileKey(profile)));
          if (missing.length) {
            latestSettings = await api.saveSettings({ accountProfiles: [...profiles, ...missing] });
            renderCodexProfileReset(latestSettings);
          }
        } catch {}
      }, 120);
    }, true);
  }

  async function sync(settings) {
    latestSettings = settings || await api.getSettings();
    ensureExtraAccountButtons();
    ensureExtraRoutingCards();
    applyRouting(latestSettings);
    renderCodexProfileReset(latestSettings);
    installSavePreservation();
    await syncAntigravityManager();
  }

  if (typeof api.onUsage === "function") {
    api.onUsage((payload) => sync(payload && payload.settings ? payload.settings : null).catch(() => {}));
  }
  setTimeout(() => sync(null).catch(() => {}), 0);
})();
