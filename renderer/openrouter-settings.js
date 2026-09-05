const openRouterStyle = document.createElement("link");
openRouterStyle.rel = "stylesheet";
openRouterStyle.href = "openrouter-settings.css";
document.head.appendChild(openRouterStyle);

const openRouterEnabledEl = document.getElementById("openRouterEnabled");
const openRouterProfilesEl = document.getElementById("openRouterProfiles");
const saveOpenRouterProfilesEl = document.getElementById("saveOpenRouterProfiles");
const openRouterProfileSelectEl = document.getElementById("openRouterProfileSelect");
const openRouterApiKeyEl = document.getElementById("openRouterApiKey");
const openRouterManagementKeyEl = document.getElementById("openRouterManagementKey");
const openRouterApiKeyStatusEl = document.getElementById("openRouterApiKeyStatus");
const openRouterManagementKeyStatusEl = document.getElementById("openRouterManagementKeyStatus");
const openRouterSecureStatusEl = document.getElementById("openRouterSecureStatus");
const saveOpenRouterKeysEl = document.getElementById("saveOpenRouterKeys");
const clearOpenRouterKeysEl = document.getElementById("clearOpenRouterKeys");
const openRouterRouterEnabledEl = document.getElementById("openRouterRouterEnabled");
const openRouterRouterPortEl = document.getElementById("openRouterRouterPort");
const openRouterRouterPolicyEl = document.getElementById("openRouterRouterPolicy");
const openRouterRouterEndpointEl = document.getElementById("openRouterRouterEndpoint");
const openRouterRouterStatusEl = document.getElementById("openRouterRouterStatus");
const copyOpenRouterRouterTokenEl = document.getElementById("copyOpenRouterRouterToken");

function cleanProfileId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) ? id : null;
}

function parseOpenRouterProfiles(text) {
  const rows = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [idRaw, labelRaw, priorityRaw, enabledRaw] = trimmed.split("|").map((part) => part.trim());
    const id = cleanProfileId(idRaw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const priority = Number(priorityRaw);
    const disabled = ["off", "false", "0", "disabled"].includes(String(enabledRaw || "").toLowerCase());
    rows.push({
      id,
      label: labelRaw || id,
      priority: Number.isFinite(priority) ? Math.max(0, Math.min(9999, Math.round(priority))) : (rows.length + 1) * 10,
      enabled: !disabled,
    });
    if (rows.length >= 16) break;
  }
  return rows;
}

function formatOpenRouterProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) =>
    `${profile.id}|${profile.label || profile.id}|${Number(profile.priority) || 0}|${profile.enabled === false ? "off" : "on"}`,
  ).join("\n");
}

function profileStatuses(settings = {}) {
  return Array.isArray(settings.openRouterProfileStatuses) ? settings.openRouterProfileStatuses : [];
}

function selectedProfileStatus(settings = {}) {
  const id = openRouterProfileSelectEl.value;
  return profileStatuses(settings).find((item) => item.id === id) || { id, apiKeyConfigured: false, managementKeyConfigured: false };
}

function configuredCopy(configured, fallback) {
  return configured ? "저장된 키 있음 · 새 값을 입력하면 교체됩니다." : fallback;
}

function syncProfileSelect(settings = {}) {
  const profiles = Array.isArray(settings.openRouterProfiles) ? settings.openRouterProfiles : [];
  const previous = openRouterProfileSelectEl.value;
  openRouterProfileSelectEl.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.label || profile.id} · 우선순위 ${profile.priority}`;
    openRouterProfileSelectEl.appendChild(option);
  }
  if (profiles.some((profile) => profile.id === previous)) openRouterProfileSelectEl.value = previous;
  else if (profiles.length) openRouterProfileSelectEl.value = profiles[0].id;
}

function applySelectedProfileStatus(settings = {}) {
  const status = selectedProfileStatus(settings);
  const hasSelection = !!openRouterProfileSelectEl.value;
  openRouterApiKeyEl.placeholder = status.apiKeyConfigured ? "저장됨 · 새 API Key 입력 시 교체" : "OpenRouter API Key";
  openRouterManagementKeyEl.placeholder = status.managementKeyConfigured ? "저장됨 · 새 Management Key 입력 시 교체" : "계정 크레딧 조회용";
  openRouterApiKeyStatusEl.textContent = configuredCopy(
    status.apiKeyConfigured,
    hasSelection ? "선택 프로필의 요청/사용량 조회 및 localhost 라우팅에 사용합니다." : "먼저 키 프로필을 추가하세요.",
  );
  openRouterManagementKeyStatusEl.textContent = configuredCopy(
    status.managementKeyConfigured,
    "계정의 총 충전 크레딧과 실제 남은 크레딧 조회에만 사용합니다.",
  );
}

function applyOpenRouterSettings(settings = {}, message = "") {
  openRouterEnabledEl.checked = settings.openRouterEnabled === true;
  const secureAvailable = settings.secureStorageAvailable === true;
  if (document.activeElement !== openRouterProfilesEl) {
    openRouterProfilesEl.value = formatOpenRouterProfiles(settings.openRouterProfiles);
  }
  syncProfileSelect(settings);
  applySelectedProfileStatus(settings);

  const router = settings.openRouterRouter || {};
  openRouterRouterEnabledEl.checked = router.enabled === true;
  openRouterRouterPortEl.value = Number(router.port) || 43123;
  openRouterRouterPolicyEl.value = router.policy === "max-remaining" ? "max-remaining" : "priority-fallback";

  const hasProfile = !!openRouterProfileSelectEl.value;
  saveOpenRouterKeysEl.disabled = !secureAvailable || !hasProfile;
  clearOpenRouterKeysEl.disabled = !secureAvailable || !hasProfile;
  openRouterApiKeyEl.disabled = !secureAvailable || !hasProfile;
  openRouterManagementKeyEl.disabled = !secureAvailable || !hasProfile;
  copyOpenRouterRouterTokenEl.disabled = !secureAvailable;
  openRouterSecureStatusEl.classList.toggle("warning", !secureAvailable);
  openRouterSecureStatusEl.textContent = message || (secureAvailable
    ? "각 프로필 키와 localhost 인증 토큰은 운영체제 safeStorage로 암호화되며 settings.json에는 원문을 기록하지 않습니다."
    : "운영체제 보안 저장소를 사용할 수 없어 키/라우터 토큰 저장이 비활성화되었습니다. 평문 저장으로 우회하지 않습니다.");
}

function routerErrorCopy(code) {
  if (code === "port-in-use") return "지정한 포트를 다른 프로그램이 사용 중입니다.";
  if (code === "secure-local-auth-unavailable") return "OS 보안 저장소에서 로컬 인증 토큰을 준비하지 못했습니다.";
  if (code === "listen-failed") return "localhost 라우터를 시작하지 못했습니다.";
  return code || "";
}

function applyOpenRouterRouterStatus(status = {}) {
  const endpoint = status.endpoint || `http://127.0.0.1:${Number(openRouterRouterPortEl.value) || 43123}/v1`;
  openRouterRouterEndpointEl.textContent = endpoint;
  const profileStates = Array.isArray(status.profiles) ? status.profiles : [];
  const usable = profileStates.filter((profile) => profile.apiKeyConfigured && !profile.cooldownUntil).length;
  const cooling = profileStates.filter((profile) => profile.cooldownUntil).length;
  if (status.running) {
    openRouterRouterStatusEl.textContent = `실행 중 · 사용 가능 키 ${usable}개${cooling ? ` · 쿨다운 ${cooling}개` : ""} · 외부 인터페이스에는 바인딩하지 않습니다.`;
    openRouterRouterStatusEl.classList.remove("warning");
  } else if (status.enabled) {
    openRouterRouterStatusEl.textContent = `시작 실패 · ${routerErrorCopy(status.lastError) || "설정을 확인하세요."}`;
    openRouterRouterStatusEl.classList.add("warning");
  } else {
    openRouterRouterStatusEl.textContent = "라우터 꺼짐 · 활성화하면 127.0.0.1에만 바인딩합니다.";
    openRouterRouterStatusEl.classList.remove("warning");
  }
}

async function refreshOpenRouterRouterStatus() {
  const status = await window.tokenWidget.getOpenRouterRouterStatus();
  applyOpenRouterRouterStatus(status);
  return status;
}

async function reloadOpenRouterSettings(message = "") {
  const settings = await window.tokenWidget.getSettings();
  applyOpenRouterSettings(settings, message);
  await refreshOpenRouterRouterStatus();
  return settings;
}

openRouterEnabledEl.onchange = async () => {
  openRouterEnabledEl.disabled = true;
  try {
    const settings = await window.tokenWidget.saveSettings({ openRouterEnabled: !!openRouterEnabledEl.checked });
    applyOpenRouterSettings(settings);
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    openRouterEnabledEl.disabled = false;
  }
};

saveOpenRouterProfilesEl.onclick = async () => {
  saveOpenRouterProfilesEl.disabled = true;
  try {
    const profiles = parseOpenRouterProfiles(openRouterProfilesEl.value);
    const settings = await window.tokenWidget.saveSettings({ openRouterProfiles: profiles });
    applyOpenRouterSettings(settings, `OpenRouter 키 프로필 ${settings.openRouterProfiles.length}개를 저장했습니다.`);
    await window.tokenWidget.configureOpenRouterRouter();
    await refreshOpenRouterRouterStatus();
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    saveOpenRouterProfilesEl.disabled = false;
  }
};

openRouterProfileSelectEl.onchange = async () => {
  const settings = await window.tokenWidget.getSettings();
  openRouterApiKeyEl.value = "";
  openRouterManagementKeyEl.value = "";
  applySelectedProfileStatus(settings);
};

saveOpenRouterKeysEl.onclick = async () => {
  const profileId = openRouterProfileSelectEl.value;
  const apiKey = openRouterApiKeyEl.value.trim();
  const managementKey = openRouterManagementKeyEl.value.trim();
  if (!profileId) {
    await reloadOpenRouterSettings("먼저 OpenRouter 키 프로필을 추가하세요.");
    return;
  }
  if (!apiKey && !managementKey) {
    await reloadOpenRouterSettings("새로 저장할 키를 입력하세요. 기존 키는 빈 입력으로 삭제되지 않습니다.");
    return;
  }

  saveOpenRouterKeysEl.disabled = true;
  try {
    const patch = {};
    if (apiKey) patch.apiKey = apiKey;
    if (managementKey) patch.managementKey = managementKey;
    const settings = await window.tokenWidget.saveOpenRouterProfileSecrets(profileId, patch);
    if (!settings.openRouterEnabled) await window.tokenWidget.saveSettings({ openRouterEnabled: true });
    openRouterApiKeyEl.value = "";
    openRouterManagementKeyEl.value = "";
    await reloadOpenRouterSettings(`${profileId} 프로필 키를 OS 보안 저장소에 암호화해 저장했습니다.`);
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    saveOpenRouterKeysEl.disabled = false;
  }
};

clearOpenRouterKeysEl.onclick = async () => {
  const profileId = openRouterProfileSelectEl.value;
  if (!profileId) return;
  clearOpenRouterKeysEl.disabled = true;
  try {
    await window.tokenWidget.clearOpenRouterProfileSecrets(profileId);
    openRouterApiKeyEl.value = "";
    openRouterManagementKeyEl.value = "";
    await reloadOpenRouterSettings(`${profileId} 프로필의 저장된 키를 삭제했습니다.`);
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    clearOpenRouterKeysEl.disabled = false;
  }
};

async function saveOpenRouterRouterSettings() {
  const patch = {
    enabled: !!openRouterRouterEnabledEl.checked,
    port: Number(openRouterRouterPortEl.value),
    policy: openRouterRouterPolicyEl.value,
  };
  const settings = await window.tokenWidget.saveSettings({ openRouterRouter: patch });
  applyOpenRouterSettings(settings);
  const status = await window.tokenWidget.configureOpenRouterRouter();
  applyOpenRouterRouterStatus(status);
  return settings;
}

[openRouterRouterEnabledEl, openRouterRouterPortEl, openRouterRouterPolicyEl].forEach((element) => {
  element.addEventListener("change", async () => {
    try {
      await saveOpenRouterRouterSettings();
    } catch (err) {
      await reloadOpenRouterSettings(err.message || String(err));
    }
  });
});

copyOpenRouterRouterTokenEl.onclick = async () => {
  copyOpenRouterRouterTokenEl.disabled = true;
  try {
    await window.tokenWidget.copyOpenRouterRouterToken();
    openRouterSecureStatusEl.classList.remove("warning");
    openRouterSecureStatusEl.textContent = "localhost 라우터 Bearer 토큰을 클립보드에 복사했습니다. 이 토큰은 OpenRouter 원본 API Key와 별개입니다.";
    await refreshOpenRouterRouterStatus();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    copyOpenRouterRouterTokenEl.disabled = false;
  }
};

reloadOpenRouterSettings().catch((err) => {
  openRouterSecureStatusEl.classList.add("warning");
  openRouterSecureStatusEl.textContent = err.message || String(err);
});

const SMART_ROUTE_PROVIDERS = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok" },
];

function smartRoutingMarkup() {
  const providerRows = SMART_ROUTE_PROVIDERS.map((provider) => `
    <div class="smart-route-card" data-route-provider="${provider.id}">
      <label class="toggle">
        <span class="toggle-copy">
          <b>${provider.label}</b>
          <small>새 CLI 실행 시 계정 자동 선택</small>
        </span>
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
        <div class="stepper">
          <input type="number" min="0" max="100" step="0.1" data-route-threshold="${provider.id}" />
          <span>% 이하</span>
        </div>
      </label>
      <button type="button" class="btn primary smart-route-launch" data-route-launch="${provider.id}">${provider.label} 스마트 실행</button>
    </div>
  `).join("");

  return `
    <div class="set-group smart-routing-group" id="smartRoutingGroup">
      <h2>Smart Routing</h2>
      <p class="security-note">새로 실행하는 CLI에만 적용합니다. 기존 세션의 인증 파일을 교체하지 않으며, 자동 정책은 오래된 quota cache를 계정 선택 근거로 사용하지 않습니다.</p>
      <div class="smart-route-list">${providerRows}</div>
      <div class="api-secret-actions smart-route-actions">
        <button type="button" class="btn subtle-danger" id="installSmartRouteLaunchers">터미널 런처 설치</button>
      </div>
      <p class="security-note" id="smartRoutingStatus">정책을 켠 뒤 스마트 실행으로 선택 결과를 확인할 수 있습니다.</p>
    </div>
  `;
}

function installSmartRoutingUi() {
  if (document.getElementById("smartRoutingGroup")) return;
  const automationGroup = document.getElementById("codexAutoUseReset")?.closest(".set-group");
  if (!automationGroup || !automationGroup.parentNode) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = smartRoutingMarkup().trim();
  automationGroup.parentNode.insertBefore(wrapper.firstElementChild, automationGroup);
}

function routeConfig(settings, providerId) {
  const config = settings && settings.smartRouting && settings.smartRouting[providerId];
  return {
    enabled: !!(config && config.enabled === true),
    policy: config && ["fixed-primary", "priority-fallback", "max-remaining"].includes(config.policy)
      ? config.policy
      : "priority-fallback",
    thresholdPct: Number.isFinite(Number(config && config.thresholdPct)) ? Number(config.thresholdPct) : 0,
  };
}

function applySmartRoutingSettings(settings = {}) {
  for (const provider of SMART_ROUTE_PROVIDERS) {
    const config = routeConfig(settings, provider.id);
    const enabled = document.querySelector(`[data-route-enabled="${provider.id}"]`);
    const policy = document.querySelector(`[data-route-policy="${provider.id}"]`);
    const threshold = document.querySelector(`[data-route-threshold="${provider.id}"]`);
    if (enabled) enabled.checked = config.enabled;
    if (policy) policy.value = config.policy;
    if (threshold) threshold.value = config.thresholdPct;
  }
}

function collectSmartRouting() {
  const result = {};
  for (const provider of SMART_ROUTE_PROVIDERS) {
    const enabled = document.querySelector(`[data-route-enabled="${provider.id}"]`);
    const policy = document.querySelector(`[data-route-policy="${provider.id}"]`);
    const threshold = document.querySelector(`[data-route-threshold="${provider.id}"]`);
    result[provider.id] = {
      enabled: !!(enabled && enabled.checked),
      policy: policy ? policy.value : "priority-fallback",
      thresholdPct: threshold ? Number(threshold.value) : 0,
    };
  }
  return result;
}

function routeStatusText(result) {
  if (!result) return "라우팅 결과가 없습니다.";
  if (result.ok) {
    const pct = Number.isFinite(Number(result.remainingPct)) ? ` · 잔여 ${Number(result.remainingPct).toFixed(1)}%` : "";
    return `${result.providerId} → ${result.accountLabel || "계정"}${pct} · 새 CLI를 실행했습니다.`;
  }
  const reasons = {
    disabled: "Smart Routing이 꺼져 있습니다.",
    "no-accounts": "등록된 계정을 찾지 못했습니다.",
    "no-usable-account": "최신 사용량 기준으로 실행 가능한 계정이 없습니다.",
    "primary-unavailable": "기본 계정을 사용할 수 없습니다.",
    "cli-not-found": "CLI 실행 파일을 찾지 못했습니다.",
    "unsupported-platform": "현재는 Windows 런처만 지원합니다.",
  };
  return reasons[result.reason] || result.error || `라우팅 실패: ${result.reason || "unknown"}`;
}

async function saveSmartRoutingUi() {
  const settings = await window.tokenWidget.saveSettings({ smartRouting: collectSmartRouting() });
  applySmartRoutingSettings(settings);
  return settings;
}

installSmartRoutingUi();

const smartRoutingStatusEl = document.getElementById("smartRoutingStatus");
document.querySelectorAll("[data-route-enabled], [data-route-policy], [data-route-threshold]").forEach((element) => {
  element.addEventListener("change", async () => {
    try {
      await saveSmartRoutingUi();
      smartRoutingStatusEl.textContent = "Smart Routing 정책을 저장했습니다.";
    } catch (err) {
      smartRoutingStatusEl.textContent = err.message || String(err);
    }
  });
});

document.querySelectorAll("[data-route-launch]").forEach((button) => {
  button.addEventListener("click", async () => {
    const providerId = button.getAttribute("data-route-launch");
    button.disabled = true;
    try {
      await saveSmartRoutingUi();
      smartRoutingStatusEl.textContent = `${providerId} 사용량을 새로 확인하고 계정을 선택하는 중...`;
      const result = await window.tokenWidget.routeLaunch(providerId);
      smartRoutingStatusEl.textContent = routeStatusText(result);
    } catch (err) {
      smartRoutingStatusEl.textContent = err.message || String(err);
    } finally {
      button.disabled = false;
    }
  });
});

document.getElementById("installSmartRouteLaunchers")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await saveSmartRoutingUi();
    const result = await window.tokenWidget.installSmartRoutingLaunchers();
    smartRoutingStatusEl.textContent = result && result.ok
      ? `터미널 런처 설치 완료: ${result.binDir} · 이 폴더를 PATH에 추가하면 codex-auto / claude-auto / grok-auto를 사용할 수 있습니다.`
      : `런처 설치 실패: ${(result && (result.error || result.reason)) || "unknown"}`;
  } catch (err) {
    smartRoutingStatusEl.textContent = err.message || String(err);
  } finally {
    button.disabled = false;
  }
});

window.tokenWidget.getSettings().then(applySmartRoutingSettings).catch((err) => {
  if (smartRoutingStatusEl) smartRoutingStatusEl.textContent = err.message || String(err);
});
