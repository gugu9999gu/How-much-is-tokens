const listEl = document.getElementById("list");
const updatedEl = document.getElementById("updated");
const settingsEl = document.getElementById("settings");
const settingsBtn = document.getElementById("settingsBtn");
const shellEl = document.querySelector(".shell");
const alwaysOnTopEl = document.getElementById("alwaysOnTop");
const denseLayoutEl = document.getElementById("denseLayout");
const edgeDockEnabledEl = document.getElementById("edgeDockEnabled");
const edgeDockOptionsEl = document.getElementById("edgeDockOptions");
const edgeDockSideInputs = [...document.querySelectorAll('input[name="edgeDockSide"]')];
const opacityEl = document.getElementById("opacity");
const opacityValueEl = document.getElementById("opacityValue");
const visualizationInputs = [...document.querySelectorAll('input[name="visualization"]')];

const VISUALIZATION_MODES = new Set(["ring", "bar", "number"]);
const EDGE_DOCK_SIDES = new Set(["top", "right", "bottom", "left"]);

let compact = false;
let hideMissing = true;
let visualization = "ring";
let lastPayload = null;
let resizeSequence = 0;

function normalizeVisualization(value) {
  return VISUALIZATION_MODES.has(value) ? value : "ring";
}

function normalizeEdgeDockSide(value) {
  return EDGE_DOCK_SIDES.has(value) ? value : "right";
}

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

function groupProviders(providers) {
  const groups = [];
  for (const provider of providers) {
    const vendor = provider.vendor || "기타";
    const current = groups[groups.length - 1];
    if (current && current.vendor === vendor) current.providers.push(provider);
    else groups.push({ vendor, providers: [provider] });
  }
  return groups;
}

function renderQuotaRing(win) {
  const remaining = win.remainingPct;
  const reset = resetText(win.resetAt);
  return `
    <div class="quota-ring-item">
      <div class="quota-ring" style="--pct:${remaining ?? 0}; --tone:${tone(remaining)};">
        <span>${pctLabel(remaining)}%</span>
      </div>
      <div class="quota-ring-copy">
        <b>${win.label}</b>
        ${reset ? `<small>${reset}</small>` : ""}
      </div>
    </div>
  `;
}

function renderQuotaBar(win) {
  const remaining = win.remainingPct;
  const reset = resetText(win.resetAt);
  return `
    <div class="quota-bar-item">
      <div class="quota-bar-head">
        <b>${win.label}</b>
        <strong>${pctLabel(remaining)}%</strong>
      </div>
      <div class="quota-bar-track">
        <i style="--pct:${remaining ?? 0}; --tone:${tone(remaining)};"></i>
      </div>
      ${reset ? `<small>${reset}</small>` : ""}
    </div>
  `;
}

function renderQuotaNumber(win) {
  const remaining = win.remainingPct;
  const reset = resetText(win.resetAt);
  return `
    <div class="quota-number-item" style="--tone:${tone(remaining)};">
      <strong>${pctLabel(remaining)}<em>%</em></strong>
      <div>
        <b>${win.label}</b>
        ${reset ? `<small>${reset}</small>` : ""}
      </div>
    </div>
  `;
}

function renderQuotaVisual(win) {
  if (visualization === "bar") return renderQuotaBar(win);
  if (visualization === "number") return renderQuotaNumber(win);
  return renderQuotaRing(win);
}

function renderSummaryVisual(provider) {
  const remaining = provider.status === "ok" ? provider.remainingPct : null;
  const display = provider.status === "ok" ? pctLabel(remaining) : "·";

  if (visualization === "bar") {
    return `
      <div class="summary-bar">
        <strong>${provider.status === "ok" ? `${display}%` : "--"}</strong>
        <div><i style="--pct:${remaining ?? 0}; --tone:${tone(remaining)};"></i></div>
      </div>
    `;
  }

  if (visualization === "number") {
    return `
      <div class="summary-number" style="--tone:${tone(remaining)};">
        <strong>${provider.status === "ok" ? display : "--"}</strong>
        <span>%</span>
      </div>
    `;
  }

  return `
    <div class="ring" style="--pct:${remaining ?? 0}; --tone:${tone(remaining)};">
      <span>${provider.status === "ok" ? display : "·"}</span>
    </div>
  `;
}

function renderProviderCard(provider) {
  const plan = provider.plan ? ` · ${provider.plan}` : "";
  const statusLine =
    provider.status === "ok"
      ? resetText(provider.resetAt)
      : provider.status === "login"
        ? "로그인 필요"
        : provider.status === "missing"
          ? "계정 없음"
          : provider.error || "오류";
  const quotaWindows = compact ? [] : (provider.windows || []);
  const showQuotaVisuals = quotaWindows.length >= 2;
  const extras = (provider.extras || [])
    .filter((item) => String(item.value || "").length < 28)
    .slice(0, compact ? 0 : 4)
    .map((item) => `<span class="chip">${item.label} ${item.value}</span>`)
    .join("");
  const quotaChips = showQuotaVisuals
    ? ""
    : quotaWindows.map((win) => `<span class="chip">${win.label} ${pctLabel(win.remainingPct)}%</span>`).join("");
  const chips = `${quotaChips}${extras}`;
  const hint = provider.status !== "ok" && provider.hint ? `<div class="hint">${provider.hint}</div>` : "";

  if (showQuotaVisuals) {
    return `
      <article class="row multi-quota visual-${visualization}">
        <div class="meta">
          <b>${provider.name}${plan}</b>
          <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
          <div class="quota-visuals quota-${visualization}s">${quotaWindows.map(renderQuotaVisual).join("")}</div>
          ${extras ? `<div class="windows">${extras}</div>` : ""}
          ${hint}
        </div>
      </article>
    `;
  }

  return `
    <article class="row visual-${visualization} ${compact ? "compact" : ""}">
      ${renderSummaryVisual(provider)}
      <div class="meta">
        <b>${provider.name}${plan}</b>
        <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
        ${chips ? `<div class="windows">${chips}</div>` : ""}
        ${hint}
      </div>
    </article>
  `;
}

function applyLayoutSettings(settings = {}) {
  shellEl.classList.toggle("dense-layout", settings.denseLayout === true);
  shellEl.classList.toggle("edge-dock-enabled", settings.edgeDockEnabled === true);
}

function render(payload) {
  lastPayload = payload;
  const settings = payload.settings || {};
  compact = !!settings.compact;
  hideMissing = settings.hideMissing !== false;
  visualization = normalizeVisualization(settings.visualization);
  applyLayoutSettings(settings);
  const providers = visibleProviders(payload.providers || []);
  const time = payload.fetchedAt ? new Date(payload.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  updatedEl.textContent = payload.error ? payload.error : time ? `${time} 갱신` : "대기";

  if (!providers.length) {
    listEl.innerHTML = `<div class="empty">표시할 구독이 없습니다. 설정에서 토큰을 추가하세요.</div>`;
    requestResize();
    return;
  }

  listEl.innerHTML = groupProviders(providers).map((group) => `
    <section class="provider-group">
      <div class="provider-group-head">
        <span>${group.vendor}</span>
        <i></i>
      </div>
      <div class="provider-group-cards">
        ${group.providers.map(renderProviderCard).join("")}
      </div>
    </section>
  `).join("");
  requestResize();
}

function px(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function desiredWindowHeight() {
  const shellStyle = getComputedStyle(shellEl);
  const titlebar = shellEl.querySelector(".titlebar");
  const titleStyle = getComputedStyle(titlebar);
  const settingsOpen = !settingsEl.classList.contains("hidden");
  const content = settingsOpen ? settingsEl : listEl;
  const contentStyle = getComputedStyle(content);

  const shellChrome =
    px(shellStyle.paddingTop) +
    px(shellStyle.paddingBottom) +
    px(shellStyle.borderTopWidth) +
    px(shellStyle.borderBottomWidth);
  const titleHeight =
    titlebar.getBoundingClientRect().height +
    px(titleStyle.marginTop) +
    px(titleStyle.marginBottom);
  let contentHeight = content.scrollHeight + px(contentStyle.marginTop) + px(contentStyle.marginBottom);

  if (settingsOpen) {
    const configuredMax = px(contentStyle.maxHeight);
    if (configuredMax > 0) contentHeight = Math.min(contentHeight, configuredMax);
  }
  return Math.ceil(shellChrome + titleHeight + contentHeight + 4);
}

async function requestResize() {
  const sequence = ++resizeSequence;
  const height = desiredWindowHeight();
  const result = await window.tokenWidget.resize(height);
  if (sequence !== resizeSequence) return;
  shellEl.classList.toggle("viewport-constrained", !!(result && result.constrained));
}

function setOpacityUi(value) {
  const opacity = Number(value);
  opacityEl.value = opacity;
  opacityValueEl.textContent = `${Math.round(opacity * 100)}%`;
  const fill = ((opacity - 0.55) / 0.45) * 100;
  opacityEl.style.setProperty("--fill", `${Math.max(0, Math.min(100, fill))}%`);
}

function setVisualizationUi(value) {
  const mode = normalizeVisualization(value);
  visualizationInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function selectedVisualization() {
  const checked = visualizationInputs.find((input) => input.checked);
  return normalizeVisualization(checked ? checked.value : visualization);
}

function setEdgeDockUi(settings) {
  const enabled = settings.edgeDockEnabled === true;
  const side = normalizeEdgeDockSide(settings.edgeDockSide);
  edgeDockEnabledEl.checked = enabled;
  edgeDockOptionsEl.classList.toggle("disabled", !enabled);
  edgeDockSideInputs.forEach((input) => {
    input.checked = input.value === side;
    input.disabled = !enabled;
  });
}

function selectedEdgeDockSide() {
  const checked = edgeDockSideInputs.find((input) => input.checked);
  return normalizeEdgeDockSide(checked ? checked.value : "right");
}

function mergePayloadSettings(settings) {
  if (!lastPayload) return;
  lastPayload = {
    ...lastPayload,
    settings: { ...(lastPayload.settings || {}), ...settings },
  };
}

function setSettingsOpen(open) {
  settingsEl.classList.toggle("hidden", !open);
  settingsBtn.classList.toggle("active", open);
  shellEl.classList.toggle("settings-open", open);
  requestResize();
}

function fillSettings(settings) {
  alwaysOnTopEl.checked = !!settings.alwaysOnTop;
  denseLayoutEl.checked = settings.denseLayout === true;
  document.getElementById("openAtLogin").checked = !!settings.openAtLogin;
  document.getElementById("hideMissing").checked = settings.hideMissing !== false;
  setVisualizationUi(settings.visualization || "ring");
  setEdgeDockUi(settings);
  applyLayoutSettings(settings);
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
alwaysOnTopEl.onchange = async () => {
  const settings = await window.tokenWidget.saveSettings({ alwaysOnTop: !!alwaysOnTopEl.checked });
  alwaysOnTopEl.checked = !!settings.alwaysOnTop;
  mergePayloadSettings({ alwaysOnTop: !!settings.alwaysOnTop });
};
denseLayoutEl.onchange = async () => {
  const settings = await window.tokenWidget.saveSettings({ denseLayout: !!denseLayoutEl.checked });
  denseLayoutEl.checked = !!settings.denseLayout;
  mergePayloadSettings({ denseLayout: !!settings.denseLayout });
  applyLayoutSettings(settings);
  requestResize();
};
edgeDockEnabledEl.onchange = async () => {
  const patch = {
    edgeDockEnabled: !!edgeDockEnabledEl.checked,
    edgeDockSide: selectedEdgeDockSide(),
  };
  const settings = await window.tokenWidget.saveSettings(patch);
  setEdgeDockUi(settings);
  mergePayloadSettings({ edgeDockEnabled: settings.edgeDockEnabled, edgeDockSide: settings.edgeDockSide });
  applyLayoutSettings(settings);
  requestResize();
};
edgeDockSideInputs.forEach((input) => {
  input.onchange = async () => {
    if (!input.checked || !edgeDockEnabledEl.checked) return;
    const settings = await window.tokenWidget.saveSettings({ edgeDockSide: normalizeEdgeDockSide(input.value) });
    setEdgeDockUi(settings);
    mergePayloadSettings({ edgeDockSide: settings.edgeDockSide });
  };
});
visualizationInputs.forEach((input) => {
  input.onchange = async () => {
    if (!input.checked) return;
    visualization = normalizeVisualization(input.value);
    const settings = await window.tokenWidget.saveSettings({ visualization });
    if (lastPayload) render({ ...lastPayload, settings });
  };
});
document.getElementById("saveBtn").onclick = async () => {
  const patch = {
    alwaysOnTop: alwaysOnTopEl.checked,
    denseLayout: denseLayoutEl.checked,
    edgeDockEnabled: edgeDockEnabledEl.checked,
    edgeDockSide: selectedEdgeDockSide(),
    openAtLogin: document.getElementById("openAtLogin").checked,
    hideMissing: document.getElementById("hideMissing").checked,
    visualization: selectedVisualization(),
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
window.tokenWidget.getSettings().then((settings) => {
  fillSettings(settings);
  requestResize();
});
window.addEventListener("resize", requestResize);
