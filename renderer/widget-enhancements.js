(() => {
  const api = window.tokenWidget;
  if (!api) return;

  const RESET_MODE_INTERVAL_MS = 5_000;
  const RESET_DISPLAY_MODES = new Set(["auto", "relative", "absolute"]);
  const RESET_DISPLAY_OPTIONS = [
    { value: "auto", icon: "↔", label: "자동" },
    { value: "relative", icon: "D", label: "남은 시간" },
    { value: "absolute", icon: "◷", label: "예정 일시" },
  ];
  const CLI_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
  const RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  let usagePayload = typeof api.getLastUsage === "function" ? api.getLastUsage() : null;
  let resetMode = "relative";
  let resetDisplayPreference = "auto";
  let resetTimer = null;
  let cliTimer = null;
  let resizePointer = null;

  function providerIdForRow(row) {
    if (!row) return "";
    if (row.providerId) return String(row.providerId).toLowerCase();
    return String(row.id || "").split(":")[0].toLowerCase();
  }

  function setHubMessage(text, warning = false) {
    const element = document.getElementById("connectionHubMessage");
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("warning", warning);
  }

  function normalizeResetDisplayPreference(value) {
    const mode = String(value || "").trim().toLowerCase();
    return RESET_DISPLAY_MODES.has(mode) ? mode : "auto";
  }

  function syncResetDisplayControls() {
    document.querySelectorAll('input[name="resetDisplayMode"]').forEach((input) => {
      input.checked = input.value === resetDisplayPreference;
    });
  }

  function syncResetDisplayPreference(settings = {}) {
    const previous = resetDisplayPreference;
    const next = normalizeResetDisplayPreference(settings.resetDisplayMode);
    resetDisplayPreference = next;
    if (next === "auto") {
      if (previous !== "auto") resetMode = "relative";
    } else {
      resetMode = next;
    }
    syncResetDisplayControls();
    return previous !== next;
  }

  function effectiveResetDisplayMode() {
    return resetDisplayPreference === "auto" ? resetMode : resetDisplayPreference;
  }

  function resetDateTimeText(ms) {
    const time = Number(ms);
    if (!Number.isFinite(time) || time <= 0) return "";
    if (time <= Date.now()) return "곧 리셋";
    const date = new Date(time);
    const now = new Date();
    const options = {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
    return `${new Intl.DateTimeFormat("ko-KR", options).format(date)} 리셋 예정`;
  }

  async function rerenderForResetMode() {
    if (!usagePayload || typeof window.render !== "function") return;
    let settings = usagePayload.settings || {};
    try {
      if (typeof api.getSettings === "function") settings = await api.getSettings();
    } catch {}
    syncResetDisplayPreference(settings);
    window.render({ ...usagePayload, settings });
  }

  function installResetDisplaySetting() {
    if (document.getElementById("resetDisplayModeField")) return;
    const visualizationField = document.querySelector(".viz-field");
    if (!visualizationField) return;

    const field = document.createElement("div");
    field.id = "resetDisplayModeField";
    field.className = "viz-field reset-display-field";

    const head = document.createElement("div");
    head.className = "viz-head";
    const title = document.createElement("b");
    title.textContent = "리셋 시간 표시";
    const description = document.createElement("small");
    description.textContent = "자동은 남은 시간과 예정 일시를 5초마다 전환";
    head.append(title, description);

    const picker = document.createElement("div");
    picker.className = "viz-picker";
    picker.setAttribute("role", "radiogroup");
    picker.setAttribute("aria-label", "AI 사용량 리셋 시간 표시 방식");

    for (const option of RESET_DISPLAY_OPTIONS) {
      const label = document.createElement("label");
      label.className = "viz-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "resetDisplayMode";
      input.value = option.value;
      input.setAttribute("aria-label", option.label);
      const box = document.createElement("span");
      const icon = document.createElement("em");
      icon.className = "viz-icon";
      icon.textContent = option.icon;
      const text = document.createElement("b");
      text.textContent = option.label;
      box.append(icon, text);
      label.append(input, box);
      picker.appendChild(label);

      input.addEventListener("change", async () => {
        if (!input.checked || typeof api.saveSettings !== "function") return;
        const previous = resetDisplayPreference;
        const requested = normalizeResetDisplayPreference(input.value);
        resetDisplayPreference = requested;
        resetMode = requested === "auto" ? "relative" : requested;
        syncResetDisplayControls();
        try {
          const settings = await api.saveSettings({ resetDisplayMode: requested });
          syncResetDisplayPreference(settings);
          await rerenderForResetMode();
        } catch (err) {
          resetDisplayPreference = previous;
          resetMode = previous === "auto" ? "relative" : previous;
          syncResetDisplayControls();
          setHubMessage(err.message || String(err), true);
          await rerenderForResetMode();
        }
      });
    }

    field.append(head, picker);
    visualizationField.insertAdjacentElement("afterend", field);
    syncResetDisplayControls();
  }

  function installResetModeCycle() {
    if (typeof window.resetText !== "function" || typeof window.render !== "function") return;
    const relativeResetText = window.resetText;
    window.resetText = (ms) => effectiveResetDisplayMode() === "absolute" ? resetDateTimeText(ms) : relativeResetText(ms);
    resetTimer = setInterval(() => {
      if (resetDisplayPreference !== "auto") return;
      resetMode = resetMode === "relative" ? "absolute" : "relative";
      rerenderForResetMode().catch(() => {});
    }, RESET_MODE_INTERVAL_MS);
  }

  function manualSizeHasHeight(settings) {
    return !!(settings && settings.manualWindowSize && Number.isFinite(Number(settings.manualWindowSize.height)));
  }

  function syncManualHeightClass(settings) {
    document.querySelector(".shell")?.classList.toggle("manual-height-size", manualSizeHasHeight(settings));
  }

  function syncEdgeToggle(settings) {
    const enabled = settings && settings.edgeDockEnabled === true;
    const headerInput = document.getElementById("headerEdgeDockToggle");
    const settingsInput = document.getElementById("edgeDockEnabled");
    if (headerInput) headerInput.checked = enabled;
    if (settingsInput && document.activeElement !== settingsInput) settingsInput.checked = enabled;
  }

  async function readSettingsAndSync() {
    if (typeof api.getSettings !== "function") return;
    try {
      const settings = await api.getSettings();
      syncEdgeToggle(settings);
      syncManualHeightClass(settings);
      const changed = syncResetDisplayPreference(settings);
      if (changed) await rerenderForResetMode();
    } catch {}
  }

  function installHeaderEdgeToggle() {
    const actions = document.querySelector(".titlebar .actions");
    if (!actions || document.getElementById("headerEdgeDockToggle")) return;
    const label = document.createElement("label");
    label.className = "header-edge-toggle";
    label.title = "엣지 숨김 패널";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "headerEdgeDockToggle";
    input.setAttribute("aria-label", "엣지 숨김 패널 켜기 또는 끄기");
    const track = document.createElement("span");
    track.className = "header-edge-track";
    track.setAttribute("aria-hidden", "true");
    label.append(input, track);
    actions.insertBefore(label, actions.firstChild);

    input.addEventListener("change", async () => {
      const requested = input.checked;
      label.classList.add("busy");
      try {
        const settings = await api.saveSettings({ edgeDockEnabled: requested });
        syncEdgeToggle(settings);
        syncManualHeightClass(settings);
      } catch (err) {
        input.checked = !requested;
        setHubMessage(err.message || String(err), true);
      } finally {
        label.classList.remove("busy");
      }
    });

    const settingsInput = document.getElementById("edgeDockEnabled");
    if (settingsInput) {
      settingsInput.addEventListener("change", () => {
        setTimeout(() => readSettingsAndSync(), 0);
      });
    }
  }

  function installResizeHandles() {
    if (document.querySelector(".widget-resize-handle")) return;
    RESIZE_DIRECTIONS.forEach((direction) => {
      const handle = document.createElement("div");
      handle.className = `widget-resize-handle ${direction}`;
      handle.dataset.resizeDirection = direction;
      handle.setAttribute("aria-hidden", "true");
      document.body.appendChild(handle);

      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || typeof api.manualWindowResize !== "function") return;
        event.preventDefault();
        event.stopPropagation();
        resizePointer = { pointerId: event.pointerId, direction };
        try { handle.setPointerCapture(event.pointerId); } catch {}
        if (direction.includes("n") || direction.includes("s")) {
          document.querySelector(".shell")?.classList.add("manual-height-size");
        }
        api.manualWindowResize({
          phase: "start",
          direction,
          x: event.screenX,
          y: event.screenY,
        }).catch(() => {});
      });

      handle.addEventListener("pointermove", (event) => {
        if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
        api.manualWindowResize({
          phase: "move",
          direction: resizePointer.direction,
          x: event.screenX,
          y: event.screenY,
        }).catch(() => {});
      });

      const finish = async (event, phase) => {
        if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
        const directionAtEnd = resizePointer.direction;
        resizePointer = null;
        try { handle.releasePointerCapture(event.pointerId); } catch {}
        try {
          const result = await api.manualWindowResize({
            phase,
            direction: directionAtEnd,
            x: event.screenX,
            y: event.screenY,
          });
          if (result && result.settings) syncManualHeightClass(result.settings);
          else await readSettingsAndSync();
        } catch {
          await readSettingsAndSync();
        }
      };
      handle.addEventListener("pointerup", (event) => finish(event, "end"));
      handle.addEventListener("pointercancel", (event) => finish(event, "cancel"));
    });
  }

  function rowsForConnection(providerId) {
    const providers = Array.isArray(usagePayload && usagePayload.providers) ? usagePayload.providers : [];
    return providers.filter((row) => providerIdForRow(row) === providerId && row.status !== "missing");
  }

  function accountLabel(row) {
    if (row && row.accountLabel) return String(row.accountLabel);
    if (row && row.profileLabel) return String(row.profileLabel);
    return "기본 계정";
  }

  async function disconnectRow(providerId, row, button) {
    if (typeof api.disconnectCredential !== "function") return;
    const label = accountLabel(row);
    const destructive = providerId === "openrouter";
    const prompt = destructive
      ? `${label} OpenRouter 키를 앱 보안 저장소에서 삭제하고 연결을 해제할까요?`
      : `${label} 연결을 위젯에서 해제할까요? CLI 자체 로그인 정보는 유지됩니다.`;
    if (!window.confirm(prompt)) return;

    button.disabled = true;
    setHubMessage(`${label} 연결을 해제하는 중...`);
    try {
      const result = await api.disconnectCredential(providerId, { profileId: row && row.profileId ? row.profileId : null });
      if (!result || !result.ok) throw new Error((result && (result.error || result.reason)) || "연결 해제 실패");
      if (result.accountProfilesText != null) {
        const input = document.getElementById("accountProfiles");
        if (input) input.value = result.accountProfilesText;
      }
      setHubMessage(`${label} 연결을 해제했습니다.${destructive ? "" : " CLI 로그인 정보는 유지됩니다."}`);
      await api.refresh();
    } catch (err) {
      setHubMessage(err.message || String(err), true);
      button.disabled = false;
    }
  }

  function syncDisconnectControls() {
    document.querySelectorAll(".connection-card[data-connection-provider]").forEach((card) => {
      const providerId = String(card.dataset.connectionProvider || "").toLowerCase();
      const rows = rowsForConnection(providerId);
      let list = card.querySelector(".connection-account-list");
      if (!rows.length) {
        if (list) list.remove();
        card.classList.remove("has-account-controls");
        return;
      }

      if (!list) {
        list = document.createElement("div");
        list.className = "connection-account-list";
        card.appendChild(list);
      }
      card.classList.add("has-account-controls");
      list.replaceChildren();
      rows.forEach((row) => {
        const chip = document.createElement("span");
        chip.className = "connection-account-chip";
        const label = document.createElement("span");
        label.textContent = accountLabel(row);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "해제";
        button.title = `${label.textContent} 연결 해제`;
        button.addEventListener("click", () => disconnectRow(providerId, row, button));
        chip.append(label, button);
        list.appendChild(chip);
      });
    });
  }

  function ensureCliVersionLine(card) {
    const copy = card.querySelector(".connection-copy");
    if (!copy) return null;
    let line = copy.querySelector(".cli-version-line");
    if (!line) {
      line = document.createElement("span");
      line.className = "cli-version-line";
      copy.appendChild(line);
    }
    return line;
  }

  function cliVersionText(status) {
    if (!status || status.installed !== true) return "CLI 없음";
    const current = status.installedVersion ? `CLI ${status.installedVersion}` : "CLI 감지됨";
    if (status.updateAvailable && status.latestVersion) return `${current} · 최신 ${status.latestVersion}`;
    if (status.autoUpdate) return `${current} · 자동 업데이트`;
    return current;
  }

  function renderCliStatuses(statuses) {
    const map = new Map((Array.isArray(statuses) ? statuses : []).map((status) => [status.providerId, status]));
    document.querySelectorAll(".connection-card[data-connection-provider]").forEach((card) => {
      const providerId = String(card.dataset.connectionProvider || "").toLowerCase();
      if (providerId === "openrouter") return;
      const status = map.get(providerId);
      const line = ensureCliVersionLine(card);
      if (!line) return;
      line.textContent = cliVersionText(status);
      line.classList.toggle("missing", !status || status.installed !== true);
      line.classList.toggle("update-available", !!(status && status.updateAvailable));

      const actions = card.querySelector(".connection-actions");
      if (!actions) return;
      let updateButton = actions.querySelector(".cli-update-btn");
      const showUpdate = !!(status && status.updateAvailable && status.updateSupported);
      if (!showUpdate) {
        if (updateButton) updateButton.remove();
        return;
      }
      if (!updateButton) {
        updateButton = document.createElement("button");
        updateButton.type = "button";
        updateButton.className = "btn cli-update-btn";
        updateButton.textContent = "업데이트";
        actions.appendChild(updateButton);
      }
      updateButton.onclick = async () => {
        updateButton.disabled = true;
        setHubMessage(`${status.label || providerId} CLI를 업데이트하는 중...`);
        try {
          const result = await api.updateCli(providerId);
          if (!result || !result.ok) throw new Error((result && (result.error || result.reason)) || "CLI 업데이트 실패");
          setHubMessage(`${status.label || providerId} CLI 업데이트를 완료했습니다.`);
          await refreshCliVersions(true);
        } catch (err) {
          setHubMessage(err.message || String(err), true);
        } finally {
          updateButton.disabled = false;
        }
      };
    });
  }

  async function refreshCliVersions(force = false) {
    if (typeof api.getCliVersions !== "function") return;
    try {
      const statuses = await api.getCliVersions({ force, checkLatest: true });
      renderCliStatuses(statuses);
    } catch (err) {
      setHubMessage(`CLI 버전 확인 실패: ${err.message || String(err)}`, true);
    }
  }

  function installConnectionEnhancements() {
    syncDisconnectControls();
    refreshCliVersions(false).catch(() => {});
    cliTimer = setInterval(() => refreshCliVersions(false).catch(() => {}), CLI_REFRESH_INTERVAL_MS);
  }

  if (typeof api.onUsage === "function") {
    api.onUsage((payload) => {
      usagePayload = payload;
      syncEdgeToggle(payload && payload.settings ? payload.settings : {});
      syncManualHeightClass(payload && payload.settings ? payload.settings : {});
      const changed = syncResetDisplayPreference(payload && payload.settings ? payload.settings : {});
      syncDisconnectControls();
      if (changed) rerenderForResetMode().catch(() => {});
    });
  }

  syncResetDisplayPreference(usagePayload && usagePayload.settings ? usagePayload.settings : {});
  installHeaderEdgeToggle();
  installResizeHandles();
  installResetDisplaySetting();
  installResetModeCycle();
  installConnectionEnhancements();
  readSettingsAndSync();

  window.addEventListener("beforeunload", () => {
    if (resetTimer) clearInterval(resetTimer);
    if (cliTimer) clearInterval(cliTimer);
  }, { once: true });
})();
