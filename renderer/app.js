const listEl = document.getElementById("list");
const updatedEl = document.getElementById("updated");
const settingsEl = document.getElementById("settings");
const settingsBtn = document.getElementById("settingsBtn");
const shellEl = document.querySelector(".shell");
const opacityEl = document.getElementById("opacity");
const opacityValueEl = document.getElementById("opacityValue");

let compact = false;
let hideMissing = true;
let lastPayload = null;

function tone(pct) {
  if (pct == null) return "var(--login)";
  if (pct <= 12) return "var(--bad)";
  if (pct <= 35) return "var(--warn)";
  return "var(--ok)";
}

function pctLabel(pct) {
  if (pct == null) return "--";
  return `${Math.round(pct)}`;
}

function resetText(ms) {
  if (!ms) return "";
  const delta = ms - Date.now();
  if (delta <= 0) return "곧 리셋";
  const minutes = Math.round(delta / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}일 ${hours}시간 후 리셋`;
  if (hours > 0) return `${hours}시간 ${mins}분 후 리셋`;
  return `${Math.max(1, mins)}분 후 리셋`;
}

function visibleProviders(providers) {
  if (!hideMissing) return providers;
  return providers.filter((p) => p.status !== "missing");
}

function render(payload) {
  lastPayload = payload;
  const settings = payload.settings || {};
  compact = !!settings.compact;
  hideMissing = settings.hideMissing !== false;
  const providers = visibleProviders(payload.providers || []);
  const time = payload.fetchedAt ? new Date(payload.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  updatedEl.textContent = payload.error ? payload.error : time ? `${time} 갱신` : "대기";

  if (!providers.length) {
    listEl.innerHTML = `<div class="empty">표시할 구독이 없습니다. 설정에서 토큰을 추가하세요.</div>`;
    requestResize();
    return;
  }

  listEl.innerHTML = providers.map((provider) => {
    const remaining = provider.remainingPct;
    const plan = provider.plan ? ` · ${provider.plan}` : "";
    const statusLine =
      provider.status === "ok"
        ? resetText(provider.resetAt)
        : provider.status === "login"
          ? "로그인 필요"
          : provider.status === "missing"
            ? "계정 없음"
            : provider.error || "오류";
    const chips = [
      ...(provider.windows || []).slice(0, compact ? 0 : 4).map((win) => `${win.label} ${pctLabel(win.remainingPct)}%`),
      ...(provider.extras || []).filter((item) => String(item.value || "").length < 28).slice(0, compact ? 0 : 4).map((item) => `${item.label} ${item.value}`),
    ].map((text) => `<span class="chip">${text}</span>`).join("");
    const hint = provider.status !== "ok" && provider.hint ? `<div class="hint">${provider.hint}</div>` : "";
    return `
      <article class="row ${compact ? "compact" : ""}">
        <div class="ring" style="--pct:${remaining ?? 0}; --tone:${tone(remaining)};">
          <span>${provider.status === "ok" ? pctLabel(remaining) : "·"}</span>
        </div>
        <div class="meta">
          <b>${provider.name}${plan}</b>
          <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
          ${chips ? `<div class="windows">${chips}</div>` : ""}
          ${hint}
        </div>
      </article>
    `;
  }).join("");
  requestResize();
}

function requestResize() {
  const shell = document.querySelector(".shell");
  const height = Math.ceil(shell.getBoundingClientRect().height) + 16;
  window.tokenWidget.resize(height);
}

function setOpacityUi(value) {
  const opacity = Number(value);
  opacityEl.value = opacity;
  opacityValueEl.textContent = `${Math.round(opacity * 100)}%`;
  const fill = ((opacity - 0.55) / 0.45) * 100;
  opacityEl.style.setProperty("--fill", `${Math.max(0, Math.min(100, fill))}%`);
}

function setSettingsOpen(open) {
  settingsEl.classList.toggle("hidden", !open);
  settingsBtn.classList.toggle("active", open);
  shellEl.classList.toggle("settings-open", open);
  requestResize();
}

function fillSettings(settings) {
  document.getElementById("alwaysOnTop").checked = !!settings.alwaysOnTop;
  document.getElementById("openAtLogin").checked = !!settings.openAtLogin;
  document.getElementById("hideMissing").checked = settings.hideMissing !== false;
  setOpacityUi(settings.opacity ?? 0.94);
  document.getElementById("refreshSeconds").value = settings.refreshSeconds ?? 60;
  document.getElementById("githubToken").value = settings.githubToken || "";
  document.getElementById("cursorCookie").value = settings.cursorCookie || "";
}

document.getElementById("refreshBtn").onclick = () => window.tokenWidget.refresh();
document.getElementById("hideBtn").onclick = () => window.tokenWidget.hide();
settingsBtn.onclick = () => setSettingsOpen(settingsEl.classList.contains("hidden"));
document.getElementById("compactBtn").onclick = async () => {
  compact = !compact;
  const settings = await window.tokenWidget.saveSettings({ compact });
  if (lastPayload) render({ ...lastPayload, settings });
};
document.getElementById("saveBtn").onclick = async () => {
  const patch = {
    alwaysOnTop: document.getElementById("alwaysOnTop").checked,
    openAtLogin: document.getElementById("openAtLogin").checked,
    hideMissing: document.getElementById("hideMissing").checked,
    opacity: Number(opacityEl.value),
    refreshSeconds: Number(document.getElementById("refreshSeconds").value),
    githubToken: document.getElementById("githubToken").value.trim(),
    cursorCookie: document.getElementById("cursorCookie").value.trim(),
  };
  const settings = await window.tokenWidget.saveSettings(patch);
  fillSettings(settings);
  setSettingsOpen(false);
  window.tokenWidget.refresh();
};
document.getElementById("quitBtn").onclick = () => window.tokenWidget.quit();
opacityEl.oninput = (event) => {
  const opacity = Number(event.target.value);
  setOpacityUi(opacity);
  window.tokenWidget.saveSettings({ opacity });
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsEl.classList.contains("hidden")) {
    setSettingsOpen(false);
  }
});

window.tokenWidget.onUsage(render);
window.tokenWidget.getSettings().then(fillSettings);
window.addEventListener("resize", requestResize);
