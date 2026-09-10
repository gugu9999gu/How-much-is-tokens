const listEl = document.getElementById("list");
const updatedEl = document.getElementById("updated");
const settingsEl = document.getElementById("settings");
const settingsBtn = document.getElementById("settingsBtn");
const shellEl = document.querySelector(".shell");
const alwaysOnTopEl = document.getElementById("alwaysOnTop");
const denseLayoutEl = document.getElementById("denseLayout");
const tokenAreaMaxHeightEl = document.getElementById("tokenAreaMaxHeight");
const accountProfilesEl = document.getElementById("accountProfiles");
const codexAutoUseResetEl = document.getElementById("codexAutoUseReset");
const edgeDockEnabledEl = document.getElementById("edgeDockEnabled");
const edgeDockOptionsEl = document.getElementById("edgeDockOptions");
const edgeDockSideInputs = [...document.querySelectorAll('input[name="edgeDockSide"]')];
const opacityEl = document.getElementById("opacity");
const opacityValueEl = document.getElementById("opacityValue");
const visualizationInputs = [...document.querySelectorAll('input[name="visualization"]')];

const VISUALIZATION_MODES = new Set(["ring", "bar", "number"]);
const EDGE_DOCK_SIDES = new Set(["top", "right", "bottom", "left"]);
const MULTI_ACCOUNT_PROVIDERS = new Set(["codex", "claude", "grok", "cursor", "copilot"]);
const TOKEN_AREA_MIN_HEIGHT = 120;
const TOKEN_AREA_MAX_HEIGHT = 2000;

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

function normalizeTokenAreaMaxHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.max(TOKEN_AREA_MIN_HEIGHT, Math.min(TOKEN_AREA_MAX_HEIGHT, Math.round(height)));
}

function formatAccountProfiles(profiles) {
  if (!Array.isArray(profiles)) return "";
  return profiles
    .filter((profile) => profile && profile.enabled !== false)
    .map((profile) => [profile.providerId, profile.label, profile.configDir].map((value) => String(value || "").trim()).join("|"))
    .filter((line) => line.replace(/\|/g, "").trim())
    .join("\n");
}

function parseAccountProfiles(text) {
  const rows = [];
  for (const sourceLine of String(text || "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const first = line.indexOf("|");
    const second = first < 0 ? -1 : line.indexOf("|", first + 1);
    if (first <= 0 || second <= first + 1) continue;
    const providerId = line.slice(0, first).trim().toLowerCase();
    const label = line.slice(first + 1, second).trim();
    const configDir = line.slice(second + 1).trim();
    if (!MULTI_ACCOUNT_PROVIDERS.has(providerId) || !label || !configDir) continue;
    rows.push({ providerId, label, configDir, enabled: true });
  }
  return rows;
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

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
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

function creditAmount(value, balance) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (balance.currency) {
    if (String(balance.currency).toUpperCase() === "USD") return `$${number.toFixed(2)}`;
    return `${String(balance.currency).toUpperCase()} ${number.toFixed(2)}`;
  }
  const rounded = Math.round(number * 100) / 100;
  return balance.unit ? `${rounded} ${balance.unit}` : String(rounded);
}

function creditBalanceText(balance) {
  if (balance.unlimited === true) return "무제한";
  const remaining = creditAmount(balance.balance, balance);
  const used = creditAmount(balance.used, balance);
  const limit = creditAmount(balance.limit, balance);
  if (remaining) return `잔여 ${remaining}`;
  if (used && limit) return `사용 ${used} / ${limit}`;
  if (limit) return `한도 ${limit}`;
  if (used) return `사용 ${used}`;
  return "";
}

function renderCreditBalances(provider) {
  const balances = Array.isArray(provider.creditBalances) ? provider.creditBalances : [];
  const visible = balances.slice(0, compact ? 1 : 4);
  if (!visible.length) return "";
  return `<div class="credit-balances">${visible.map((balance) => {
    const text = creditBalanceText(balance);
    const reset = resetText(balance.resetAt);
    const pct = Number.isFinite(Number(balance.remainingPct)) ? `${Math.round(Number(balance.remainingPct))}%` : "";
    const detail = [text, pct, reset].filter(Boolean).join(" · ");
    return `<span class="credit-chip"><b>${balance.label || "크레딧"}</b>${detail ? `<small>${detail}</small>` : ""}</span>`;
  }).join("")}</div>`;
}

function renderProviderLogs(provider) {
  if (compact) return "";
  const logs = Array.isArray(provider.logs)
    ? provider.logs.filter((entry) => entry && entry.label).slice(0, 4)
    : [];
  if (!logs.length) return "";
  const title = provider.logsTitle
    ? `<div class="provider-logs-title">${escapeHtml(provider.logsTitle)}</div>`
    : "";
  return `<div class="provider-logs">${title}${logs.map((entry) => `
    <span class="log-line"><b>${escapeHtml(entry.label)}</b>${entry.sub ? `<small>${escapeHtml(entry.sub)}</small>` : ""}</span>
  `).join("")}</div>`;
}

function renderProviderNote(provider) {
  return provider.note ? `<div class="hint">${escapeHtml(provider.note)}</div>` : "";
}

function renderProviderCard(provider) {
  const plan = provider.plan ? ` · ${provider.plan}` : "";
  const account = provider.accountLabel ? ` · ${provider.accountLabel}` : "";
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
  const maxExtras = Number.isFinite(Number(provider.maxExtras)) ? Math.max(0, Number(provider.maxExtras)) : 4;
  const extras = (provider.extras || [])
    .filter((item) => String(item.value || "").length < 36)
    .slice(0, compact ? 0 : maxExtras)
    .map((item) => `<span class="chip">${item.label} ${item.value}</span>`)
    .join("");
  const quotaChips = showQuotaVisuals
    ? ""
    : quotaWindows.map((win) => `<span class="chip">${win.label} ${pctLabel(win.remainingPct)}%</span>`).join("");
  const chips = `${quotaChips}${extras}`;
  const credits = renderCreditBalances(provider);
  const hint = provider.status !== "ok" && provider.hint ? `<div class="hint">${provider.hint}</div>` : "";

  if (showQuotaVisuals) {
    return `
      <article class="row multi-quota visual-${visualization}">
        <div class="meta">
          <b>${provider.name}${account}${plan}</b>
          <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
          <div class="quota-visuals quota-${visualization}s">${quotaWindows.map(renderQuotaVisual).join("")}</div>
          ${credits}
          ${extras ? `<div class="windows">${extras}</div>` : ""}
          ${renderProviderLogs(provider)}
          ${renderProviderNote(provider)}
          ${hint}
        </div>
      </article>
    `;
  }

  return `
    <article class="row visual-${visualization} ${compact ? "compact" : ""}">
      ${renderSummaryVisual(provider)}
      <div class="meta">
        <b>${provider.name}${account}${plan}</b>
        <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
        ${credits}
        ${chips ? `<div class="windows">${chips}</div>` : ""}
        ${renderProviderLogs(provider)}
        ${renderProviderNote(provider)}
        ${hint}
      </div>
    </article>
  `;
}

function applyContentLayoutSettings(settings = {}) {
  const tokenAreaMaxHeight = normalizeTokenAreaMaxHeight(settings.tokenAreaMaxHeight);
  shellEl.classList.toggle("dense-layout", settings.denseLayout === true);
  shellEl.classList.toggle("token-height-limited", tokenAreaMaxHeight > 0);
  listEl.style.maxHeight = tokenAreaMaxHeight > 0 ? `${tokenAreaMaxHeight}px` : "";
}

function applyEdgeInteractionSettings(settings = {}) {
  shellEl.classList.toggle("edge-dock-enabled", settings.edgeDockEnabled === true);
}

function render(payload) {
  lastPayload = payload;
  const settings = payload.settings || {};
  compact = !!settings.compact;
  hideMissing = settings.hideMissing !== false;
  visualization = normalizeVisualization(settings.visualization);
  applyContentLayoutSettings(settings);
  applyEdgeInteractionSettings(settings);
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

  const configuredMax = px(contentStyle.maxHeight);
  if (configuredMax > 0) contentHeight = Math.min(contentHeight, configuredMax);

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
  settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  shellEl.classList.toggle("settings-open", open);
  requestResize();
}

function fillSettings(settings) {
  alwaysOnTopEl.checked = !!settings.alwaysOnTop;
  denseLayoutEl.checked = settings.denseLayout === true;
  tokenAreaMaxHeightEl.value = normalizeTokenAreaMaxHeight(settings.tokenAreaMaxHeight);
  accountProfilesEl.value = formatAccountProfiles(settings.accountProfiles);
  codexAutoUseResetEl.checked = settings.codexAutoUseReset === true;
  document.getElementById("openAtLogin").checked = !!settings.openAtLogin;
  document.getElementById("hideMissing").checked = settings.hideMissing !== false;
  setVisualizationUi(settings.visualization || "ring");
  setEdgeDockUi(settings);
  applyContentLayoutSettings(settings);
  applyEdgeInteractionSettings(settings);
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
  applyContentLayoutSettings(settings);
  requestResize();
};
tokenAreaMaxHeightEl.onchange = async () => {
  const tokenAreaMaxHeight = normalizeTokenAreaMaxHeight(tokenAreaMaxHeightEl.value);
  const settings = await window.tokenWidget.saveSettings({ tokenAreaMaxHeight });
  tokenAreaMaxHeightEl.value = settings.tokenAreaMaxHeight;
  mergePayloadSettings({ tokenAreaMaxHeight: settings.tokenAreaMaxHeight });
  applyContentLayoutSettings(settings);
  requestResize();
};
codexAutoUseResetEl.onchange = async () => {
  const settings = await window.tokenWidget.saveSettings({ codexAutoUseReset: !!codexAutoUseResetEl.checked });
  codexAutoUseResetEl.checked = settings.codexAutoUseReset === true;
  mergePayloadSettings({ codexAutoUseReset: settings.codexAutoUseReset === true });
  window.tokenWidget.refresh();
};
edgeDockEnabledEl.onchange = async () => {
  const patch = {
    edgeDockEnabled: !!edgeDockEnabledEl.checked,
    edgeDockSide: selectedEdgeDockSide(),
  };
  resizeSequence += 1;
  edgeDockEnabledEl.disabled = true;
  try {
    const settings = await window.tokenWidget.saveSettings(patch);
    setEdgeDockUi(settings);
    mergePayloadSettings({ edgeDockEnabled: settings.edgeDockEnabled, edgeDockSide: settings.edgeDockSide });
    applyEdgeInteractionSettings(settings);
  } finally {
    edgeDockEnabledEl.disabled = false;
  }
};
edgeDockSideInputs.forEach((input) => {
  input.onchange = async () => {
    if (!input.checked || !edgeDockEnabledEl.checked) return;
    const settings = await window.tokenWidget.saveSettings({ edgeDockSide: normalizeEdgeDockSide(input.value) });
    setEdgeDockUi(settings);
    mergePayloadSettings({ edgeDockSide: settings.edgeDockSide });
    applyEdgeInteractionSettings(settings);
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
    tokenAreaMaxHeight: normalizeTokenAreaMaxHeight(tokenAreaMaxHeightEl.value),
    accountProfiles: parseAccountProfiles(accountProfilesEl.value),
    codexAutoUseReset: codexAutoUseResetEl.checked,
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