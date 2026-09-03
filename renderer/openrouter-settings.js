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
