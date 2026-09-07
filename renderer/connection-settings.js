const connectionStyle = document.createElement("link");
connectionStyle.rel = "stylesheet";
connectionStyle.href = "connection-settings.css";
document.head.appendChild(connectionStyle);

const CONNECTION_PROVIDERS = [
  { id: "codex", label: "Codex", detail: "ChatGPT 계정", multi: true },
  { id: "claude", label: "Claude", detail: "Claude.ai / Console", multi: true },
  { id: "grok", label: "Grok", detail: "xAI 계정", multi: true },
  { id: "cursor", label: "Cursor", detail: "Cursor 계정", multi: false },
  { id: "copilot", label: "Copilot", detail: "GitHub OAuth", multi: false },
  { id: "antigravity", label: "Antigravity", detail: "Google 계정", multi: false },
  { id: "openrouter", label: "OpenRouter", detail: "OAuth PKCE", multi: true },
];

let latestConnectionPayload = null;
let connectionMessageTimer = null;

function providerIdForConnection(row) {
  if (!row) return "";
  if (row.providerId) return String(row.providerId).toLowerCase();
  return String(row.id || "").split(":")[0].toLowerCase();
}

function providerRows(providerId) {
  const providers = Array.isArray(latestConnectionPayload && latestConnectionPayload.providers)
    ? latestConnectionPayload.providers
    : [];
  return providers.filter((row) => providerIdForConnection(row) === providerId);
}

function connectionState(providerId) {
  const rows = providerRows(providerId);
  const connected = rows.filter((row) => row.status === "ok");
  const login = rows.filter((row) => row.status === "login");
  const errors = rows.filter((row) => row.status === "error");
  const registered = rows.filter((row) => row.status !== "missing").length;
  if (connected.length) {
    return {
      tone: "connected",
      label: connected.length > 1 ? `연결됨 · ${connected.length}개` : "연결됨",
      action: "다시 로그인",
      registered,
    };
  }
  if (login.length) return { tone: "attention", label: "다시 로그인 필요", action: "로그인", registered };
  if (errors.length) return { tone: "attention", label: "연결 확인 필요", action: "다시 시도", registered };
  return { tone: "missing", label: "연결 안 됨", action: "로그인", registered: 0 };
}

function setConnectionMessage(text, warning = false) {
  const element = document.getElementById("connectionHubMessage");
  if (!element) return;
  element.textContent = text || "";
  element.classList.toggle("warning", warning);
  if (connectionMessageTimer) clearTimeout(connectionMessageTimer);
  if (text && !warning) {
    connectionMessageTimer = setTimeout(() => {
      if (element.textContent === text) element.textContent = "";
    }, 9000);
  }
}

function failureCopy(result, provider) {
  const reason = result && result.reason;
  if (reason === "cli-not-found") {
    const commands = Array.isArray(result.commands) ? result.commands.join(" / ") : provider.label;
    return `${commands} CLI를 찾지 못했습니다. CLI 설치 후 다시 시도하거나 고급 설정의 수동 연결을 사용하세요.`;
  }
  if (reason === "unsupported-platform") return "현재 로그인 실행은 Windows 앱에서 지원합니다.";
  if (reason === "profiles-not-supported") return `${provider.label}은 현재 앱에서 추가 계정 프로필을 자동 생성하지 않습니다.`;
  if (reason === "profile-save-failed") return "격리 로그인 프로필을 저장하지 못했습니다.";
  return (result && (result.error || result.reason)) || "로그인 흐름을 시작하지 못했습니다.";
}

function formatAccountProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile && profile.enabled !== false)
    .map((profile) => `${profile.providerId}|${profile.label}|${profile.configDir}`)
    .join("\n");
}

function formatOpenRouterProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .map((profile) => `${profile.id}|${profile.label || profile.id}|${Number(profile.priority) || 0}|${profile.enabled === false ? "off" : "on"}`)
    .join("\n");
}

function syncAdvancedInputs(settings = {}) {
  const accountProfiles = document.getElementById("accountProfiles");
  if (accountProfiles && document.activeElement !== accountProfiles) {
    accountProfiles.value = formatAccountProfiles(settings.accountProfiles);
  }

  const openRouterProfiles = document.getElementById("openRouterProfiles");
  if (openRouterProfiles && document.activeElement !== openRouterProfiles) {
    openRouterProfiles.value = formatOpenRouterProfiles(settings.openRouterProfiles);
  }
  const openRouterEnabled = document.getElementById("openRouterEnabled");
  if (openRouterEnabled) openRouterEnabled.checked = settings.openRouterEnabled === true;

  const profileSelect = document.getElementById("openRouterProfileSelect");
  if (profileSelect) {
    const previous = profileSelect.value;
    const profiles = Array.isArray(settings.openRouterProfiles) ? settings.openRouterProfiles : [];
    profileSelect.replaceChildren();
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.label || profile.id} · 우선순위 ${profile.priority}`;
      profileSelect.appendChild(option);
    });
    if (profiles.some((profile) => profile.id === previous)) profileSelect.value = previous;
  }
}

async function refreshConnections() {
  setConnectionMessage("연결 상태를 확인하는 중...");
  await window.tokenWidget.refresh();
  const settings = await window.tokenWidget.getSettings();
  syncAdvancedInputs(settings);
}

async function runConnect(provider, button) {
  button.disabled = true;
  setConnectionMessage(`${provider.label} 로그인 흐름을 시작합니다...`);
  try {
    const result = await window.tokenWidget.connectCredential(provider.id);
    if (!result || !result.ok) {
      setConnectionMessage(failureCopy(result, provider), true);
      return;
    }
    const settings = await window.tokenWidget.getSettings();
    syncAdvancedInputs(settings);
    if (result.needsRefresh) {
      setConnectionMessage(`${provider.label} 로그인 창을 열었습니다. 브라우저/터미널에서 완료한 뒤 ‘상태 새로고침’을 누르세요.`);
    } else {
      setConnectionMessage(`${provider.label} 연결이 완료되었습니다.`);
      await window.tokenWidget.refresh();
    }
  } catch (err) {
    setConnectionMessage(err.message || String(err), true);
  } finally {
    button.disabled = false;
  }
}

async function runAddAccount(provider, button) {
  button.disabled = true;
  setConnectionMessage(`${provider.label} 추가 계정을 준비하는 중...`);
  try {
    const result = await window.tokenWidget.addCredentialAccount(provider.id);
    if (!result || !result.ok) {
      setConnectionMessage(failureCopy(result, provider), true);
      return;
    }
    const settings = await window.tokenWidget.getSettings();
    syncAdvancedInputs(settings);
    if (result.needsRefresh) {
      setConnectionMessage(`${result.accountLabel || provider.label} 격리 프로필을 만들고 로그인 창을 열었습니다. 로그인 완료 후 상태를 새로고침하세요.`);
    } else {
      setConnectionMessage(`${result.accountLabel || provider.label} 연결이 완료되었습니다.`);
      await window.tokenWidget.refresh();
    }
  } catch (err) {
    setConnectionMessage(err.message || String(err), true);
  } finally {
    button.disabled = false;
  }
}

function makeProviderCard(provider) {
  const card = document.createElement("div");
  card.className = "connection-card";
  card.dataset.connectionProvider = provider.id;

  const copy = document.createElement("div");
  copy.className = "connection-copy";
  const title = document.createElement("b");
  title.textContent = provider.label;
  const detail = document.createElement("small");
  detail.textContent = provider.detail;
  copy.append(title, detail);

  const status = document.createElement("span");
  status.className = "connection-status missing";
  status.dataset.connectionStatus = provider.id;
  status.textContent = "확인 중";

  const actions = document.createElement("div");
  actions.className = "connection-actions";
  const connect = document.createElement("button");
  connect.type = "button";
  connect.className = "btn primary compact-btn";
  connect.dataset.connectionAction = provider.id;
  connect.textContent = "로그인";
  connect.addEventListener("click", () => runConnect(provider, connect));
  actions.appendChild(connect);

  if (provider.multi) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn subtle compact-btn";
    add.dataset.connectionAdd = provider.id;
    add.textContent = "+ 계정";
    add.addEventListener("click", () => runAddAccount(provider, add));
    actions.appendChild(add);
  }

  card.append(copy, status, actions);
  return card;
}

function renderConnectionStates() {
  CONNECTION_PROVIDERS.forEach((provider) => {
    const state = connectionState(provider.id);
    const status = document.querySelector(`[data-connection-status="${provider.id}"]`);
    const action = document.querySelector(`[data-connection-action="${provider.id}"]`);
    if (status) {
      status.className = `connection-status ${state.tone}`;
      status.textContent = state.label;
    }
    if (action) action.textContent = state.action;
  });
}

function installConnectionHub() {
  const settings = document.getElementById("settings");
  if (!settings || document.getElementById("connectionHub")) return;

  const hub = document.createElement("div");
  hub.id = "connectionHub";
  hub.className = "set-group connections-group";
  const heading = document.createElement("div");
  heading.className = "connections-heading";
  heading.innerHTML = "<div><h2>계정 연결</h2><p>키 파일이나 경로를 직접 입력하지 않고 로그인부터 시작합니다.</p></div>";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "btn subtle compact-btn";
  refresh.textContent = "상태 새로고침";
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    try { await refreshConnections(); } catch (err) { setConnectionMessage(err.message || String(err), true); }
    finally { refresh.disabled = false; }
  });
  heading.appendChild(refresh);

  const grid = document.createElement("div");
  grid.className = "connection-grid";
  CONNECTION_PROVIDERS.forEach((provider) => grid.appendChild(makeProviderCard(provider)));
  const message = document.createElement("p");
  message.id = "connectionHubMessage";
  message.className = "connection-hub-message";
  message.setAttribute("aria-live", "polite");
  hub.append(heading, grid, message);

  const firstGroup = [...settings.children].find((element) => element.classList && element.classList.contains("set-group"));
  settings.insertBefore(hub, firstGroup || settings.firstChild);

  const displayGroup = firstGroup;
  const advanced = document.createElement("details");
  advanced.id = "advancedSettings";
  advanced.className = "advanced-settings";
  const summary = document.createElement("summary");
  summary.innerHTML = "<span><b>고급 설정</b><small>다계정 경로 · Smart Routing · API Key 직접 입력 · 세부 표시</small></span><i>›</i>";
  const content = document.createElement("div");
  content.className = "advanced-settings-content";

  const groups = [...settings.children].filter((element) =>
    element.classList && element.classList.contains("set-group") && element !== hub && element !== displayGroup,
  );
  groups.forEach((group) => content.appendChild(group));
  advanced.append(summary, content);

  const actions = settings.querySelector(".settings-actions");
  settings.insertBefore(advanced, actions || null);
  const save = document.getElementById("saveBtn");
  if (save) save.textContent = "완료";
  advanced.addEventListener("toggle", () => window.dispatchEvent(new Event("resize")));
  renderConnectionStates();
  window.dispatchEvent(new Event("resize"));
}

installConnectionHub();
window.tokenWidget.onUsage((payload) => {
  latestConnectionPayload = payload;
  renderConnectionStates();
});
window.tokenWidget.getSettings().then(syncAdvancedInputs).catch(() => {});