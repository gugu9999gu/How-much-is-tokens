const openRouterStyle = document.createElement("link");
openRouterStyle.rel = "stylesheet";
openRouterStyle.href = "openrouter-settings.css";
document.head.appendChild(openRouterStyle);

const openRouterEnabledEl = document.getElementById("openRouterEnabled");
const openRouterApiKeyEl = document.getElementById("openRouterApiKey");
const openRouterManagementKeyEl = document.getElementById("openRouterManagementKey");
const openRouterApiKeyStatusEl = document.getElementById("openRouterApiKeyStatus");
const openRouterManagementKeyStatusEl = document.getElementById("openRouterManagementKeyStatus");
const openRouterSecureStatusEl = document.getElementById("openRouterSecureStatus");
const saveOpenRouterKeysEl = document.getElementById("saveOpenRouterKeys");
const clearOpenRouterKeysEl = document.getElementById("clearOpenRouterKeys");

function configuredCopy(configured, fallback) {
  return configured ? "저장된 키 있음 · 새 값을 입력하면 교체됩니다." : fallback;
}

function applyOpenRouterSettings(settings = {}, message = "") {
  openRouterEnabledEl.checked = settings.openRouterEnabled === true;
  const apiConfigured = settings.openrouterApiKeyConfigured === true;
  const managementConfigured = settings.openrouterManagementKeyConfigured === true;
  const secureAvailable = settings.secureStorageAvailable === true;

  openRouterApiKeyEl.placeholder = apiConfigured ? "저장됨 · 새 API Key 입력 시 교체" : "sk-or-v1-...";
  openRouterManagementKeyEl.placeholder = managementConfigured ? "저장됨 · 새 Management Key 입력 시 교체" : "계정 크레딧 조회용";
  openRouterApiKeyStatusEl.textContent = configuredCopy(
    apiConfigured,
    "해당 키의 누적/일간/주간/월간 사용량과 Key 한도를 조회합니다.",
  );
  openRouterManagementKeyStatusEl.textContent = configuredCopy(
    managementConfigured,
    "계정의 총 충전 크레딧과 실제 남은 크레딧을 조회할 때 필요합니다.",
  );

  saveOpenRouterKeysEl.disabled = !secureAvailable;
  openRouterApiKeyEl.disabled = !secureAvailable;
  openRouterManagementKeyEl.disabled = !secureAvailable;
  openRouterSecureStatusEl.classList.toggle("warning", !secureAvailable);
  openRouterSecureStatusEl.textContent = message || (secureAvailable
    ? "키는 운영체제 보안 저장소로 암호화됩니다. Windows에서는 DPAPI를 사용하며 settings.json에는 원문을 기록하지 않습니다."
    : "운영체제 보안 저장소를 사용할 수 없어 키 저장이 비활성화되었습니다. 평문 저장으로 우회하지 않습니다.");
}

async function reloadOpenRouterSettings(message = "") {
  const settings = await window.tokenWidget.getSettings();
  applyOpenRouterSettings(settings, message);
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

saveOpenRouterKeysEl.onclick = async () => {
  const apiKey = openRouterApiKeyEl.value.trim();
  const managementKey = openRouterManagementKeyEl.value.trim();
  if (!apiKey && !managementKey) {
    await reloadOpenRouterSettings("새로 저장할 키를 입력하세요. 기존 키는 빈 입력으로 삭제되지 않습니다.");
    return;
  }

  saveOpenRouterKeysEl.disabled = true;
  try {
    const patch = { openRouterEnabled: true };
    if (apiKey) patch.openRouterApiKey = apiKey;
    if (managementKey) patch.openRouterManagementKey = managementKey;
    const settings = await window.tokenWidget.saveSettings(patch);
    openRouterApiKeyEl.value = "";
    openRouterManagementKeyEl.value = "";
    applyOpenRouterSettings(settings, "OpenRouter 키를 운영체제 보안 저장소에 암호화해 저장하고 공급자를 활성화했습니다.");
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    saveOpenRouterKeysEl.disabled = false;
  }
};

clearOpenRouterKeysEl.onclick = async () => {
  clearOpenRouterKeysEl.disabled = true;
  try {
    const settings = await window.tokenWidget.saveSettings({ clearOpenRouterSecrets: true, openRouterEnabled: false });
    openRouterApiKeyEl.value = "";
    openRouterManagementKeyEl.value = "";
    applyOpenRouterSettings(settings, "저장된 OpenRouter 키를 삭제하고 공급자를 비활성화했습니다.");
    window.tokenWidget.refresh();
  } catch (err) {
    await reloadOpenRouterSettings(err.message || String(err));
  } finally {
    clearOpenRouterKeysEl.disabled = false;
  }
};

reloadOpenRouterSettings().catch((err) => {
  openRouterSecureStatusEl.classList.add("warning");
  openRouterSecureStatusEl.textContent = err.message || String(err);
});

// Smart Routing is intentionally wired from the existing settings-side script
// so the renderer remains context-isolated. The only privileged operations are
// the provider-enum launch/install functions exposed by preload.js.
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
