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
const PROVIDER_LOGOS = {
  codex: { src: "./assets/platform-logos/openai.svg", label: "OpenAI" },
  claude: { src: "./assets/platform-logos/anthropic.svg", label: "Anthropic" },
  antigravity: { src: "./assets/platform-logos/antigravity.svg", label: "Google Antigravity", wide: true },
  grok: { src: "./assets/platform-logos/grok.svg", label: "Grok" },
  grokbot: { src: "./assets/platform-logos/grok.svg", label: "Grok" },
  cursor: { src: "./assets/platform-logos/cursor.svg", label: "Cursor" },
  copilot: { src: "./assets/platform-logos/github.svg", label: "GitHub" },
  openrouter: { src: "./assets/platform-logos/openrouter.svg", label: "OpenRouter" },
  falai: { src: "./assets/platform-logos/falai.svg", label: "fal.ai", wide: true },
  higgsfield: { src: "./assets/platform-logos/higgsfield.svg", label: "Higgsfield" },
  magnific: { src: "./assets/platform-logos/magnific.svg", label: "Magnific" },
  elevenlabs: { src: "./assets/platform-logos/elevenlabs.svg", label: "ElevenLabs" },
  stability: { fallback: "S", label: "Stability AI" },
};
const TOKEN_AREA_MIN_HEIGHT = 120;
const TOKEN_AREA_MAX_HEIGHT = 2000;

let compact = false;
let pinnedAccounts = [];
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

function pinKey(provider) {
  const id = baseProviderId(provider);
  const profile = provider && provider.profileId ? String(provider.profileId) : "default";
  return `${id}:${profile}`.toLowerCase();
}

function isPinned(provider) {
  return pinnedAccounts.includes(pinKey(provider));
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

const CLI_CARD_PROVIDERS = new Set(["codex", "claude", "grok", "cursor", "grokbot", "copilot", "antigravity"]);
const COUPON_PROVIDERS = new Set(["codex", "claude"]);

function baseProviderId(provider) {
  return String((provider && (provider.providerId || provider.id)) || "")
    .trim()
    .toLowerCase()
    .split(":")[0];
}

function cycleDateText(ms) {
  const time = Number(ms);
  if (!Number.isFinite(time) || time <= 0) return "";
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function fiveHourWindow(provider) {
  const windows = Array.isArray(provider && provider.windows) ? provider.windows : [];
  return windows.find((win) => {
    const id = String(win && win.id || "");
    const label = String(win && win.label || "");
    return id === "five_hour" || id === "session" || id === "5h" || label.includes("5시간");
  }) || null;
}

function metaCell(label, value, detail, extraClass, slot) {
  const cls = `meta-cell${extraClass ? ` ${extraClass}` : ""}`;
  const slotAttr = slot ? ` data-meta-slot="${escapeHtml(slot)}"` : "";
  return `<div class="${cls}"${slotAttr}><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function cleanMeta(value) {
  return value == null ? "" : String(value).trim();
}

function accountFactParts(row) {
  const email = cleanMeta(row && row.accountEmail);
  const login = cleanMeta(row && row.accountLogin);
  const accountId = cleanMeta(row && row.accountId);
  const label = cleanMeta(row && row.accountIdentityLabel);
  const value = email || login || accountId || label;
  const details = [];
  if (login && login !== email && login !== value) details.push(login);
  if (accountId && accountId !== email && accountId !== login && accountId !== value) details.push(`ID ${accountId}`);
  return {
    value: value || "정보 없음",
    detail: details.join(" · "),
    title: [value, ...details].filter(Boolean).join(" · "),
    missing: !value,
  };
}

function couponMeta(provider) {
  const id = baseProviderId(provider);
  if (!COUPON_PROVIDERS.has(id)) return null;
  const coupons = provider && provider.resetCoupons;
  if (!coupons || coupons.visibility === "unknown" || (coupons.availableCount == null && coupons.visibility !== "web-only")) {
    return { label: "리셋 쿠폰", value: "확인 불가", detail: "", missing: true };
  }
  if (coupons.visibility === "web-only") {
    return { label: "리셋 쿠폰", value: "웹 전용", detail: "claude.ai에서 확인", missing: true };
  }
  const count = Math.max(0, Number(coupons.availableCount) || 0);
  const detail = [
    coupons.applicableCount === 0 && count > 0 ? "적용 대기" : "",
    coupons.tickets && coupons.tickets[0] && coupons.tickets[0].expiresAt
      ? `${cycleDateText(coupons.tickets[0].expiresAt)}까지`
      : "",
  ].filter(Boolean).join(" · ");
  return { label: "리셋 쿠폰", value: `${count}개`, detail, missing: false };
}

function billingMeta(provider) {
  const billing = provider && provider.billing;
  if (billing && billing.renewsAt) {
    return {
      label: billing.label || "결제일",
      value: cycleDateText(billing.renewsAt),
      detail: billing.startedAt ? `${cycleDateText(billing.startedAt)} 시작` : "",
      missing: false,
    };
  }
  const renewal = provider && provider.accessRenewal;
  if (renewal && renewal.renewsAt) {
    return {
      label: renewal.label || "한도 갱신",
      value: cycleDateText(renewal.renewsAt),
      detail: renewal.windowLabel || "주간 한도",
      missing: false,
    };
  }
  if (billing && billing.startedAt) {
    const plan = billing.planLabel ? `${billing.planLabel} · ` : "";
    return {
      label: "구독",
      value: billing.status === "active" ? `${plan}구독 중` : "시작일 확인",
      detail: `${cycleDateText(billing.startedAt)} 시작`,
      missing: false,
    };
  }
  if (billing && billing.note) {
    const [value, detail = ""] = String(billing.note).split(" · ");
    return { label: billing.label || "결제", value, detail, missing: true };
  }
  return { label: "결제", value: "정보 없음", detail: "결제일을 주지 않음", missing: true };
}

function renderAccountMeta(provider) {
  if (!provider || provider.status !== "ok") return "";
  const id = baseProviderId(provider);
  const account = accountFactParts(provider);
  const cells = [
    `<div class="meta-cell meta-account${account.missing ? " missing" : ""}" data-meta-slot="account"${account.title ? ` title="${escapeHtml(account.title)}"` : ""}><span>계정</span><div class="account-identity-line"><b>${escapeHtml(account.value)}</b>${account.detail ? `<small>${escapeHtml(account.detail)}</small>` : ""}</div></div>`,
  ];
  const billing = billingMeta(provider);
  cells.push(metaCell(billing.label, billing.value, billing.detail, `meta-billing${billing.missing ? " missing" : ""}`, "billing"));
  if (CLI_CARD_PROVIDERS.has(id)) {
    cells.push(`<div class="meta-cell meta-cli" data-meta-slot="version" data-cli-provider="${escapeHtml(id)}"><span>버전</span><b class="cli-card-version">확인 중</b><small class="cli-card-state"></small></div>`);
  }
  const coupon = couponMeta(provider);
  if (coupon) cells.push(metaCell(coupon.label, coupon.value, coupon.detail, `meta-coupon${coupon.missing ? " missing" : ""}`, "coupon"));
  return `<div class="account-meta">${cells.join("")}</div>`;
}

function displayPlan(plan) {
  const text = String(plan || "").trim();
  if (!text || /default_|_tier|claude_ai/i.test(text)) return "";
  if (text.length > 22) return "";
  return text.replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function providerLogoKey(provider) {
  return String(provider.providerId || provider.id || "")
    .trim()
    .toLowerCase()
    .split(":")[0];
}

function renderPinButton(provider) {
  const key = pinKey(provider);
  const pinned = isPinned(provider);
  const label = pinned ? "상단 고정 해제" : "상단 고정";
  return `<button type="button" class="pin-btn${pinned ? " pinned" : ""}" data-pin-key="${escapeHtml(key)}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${label}" title="${label}">📌</button>`;
}

function renderProviderTitle(provider, account, plan) {
  const logo = PROVIDER_LOGOS[providerLogoKey(provider)];
  const title = escapeHtml(`${provider.name || ""}${account}`);
  const badge = displayPlan(plan.replace(/^ · /, "")) ;
  const planBadge = badge ? `<em class="plan-badge">${escapeHtml(badge)}</em>` : "";
  const pin = renderPinButton(provider);
  if (!logo) return `<div class="provider-title"><b>${title}</b>${planBadge}${pin}</div>`;

  const label = escapeHtml(logo.label || provider.name || "Provider");
  const icon = logo.src
    ? `<span class="provider-logo${logo.wide ? " provider-logo--wide" : ""}" title="${label}"><img src="${logo.src}" alt="" aria-hidden="true" draggable="false"></span>`
    : `<span class="provider-logo provider-logo--fallback" title="${label}" aria-hidden="true">${escapeHtml(logo.fallback || "?")}</span>`;
  return `<div class="provider-title">${icon}<b>${title}</b>${planBadge}${pin}</div>`;
}

function quotaRank(win) {
  const text = `${win && win.id || ""} ${win && win.label || ""}`.toLowerCase();
  if (/five|5시간|session|\b5h\b/.test(text)) return 0;
  if (/week|주간|seven/.test(text)) return 1;
  if (/month|월간/.test(text)) return 2;
  return 5;
}

function compactQuotaWindows(provider) {
  const windows = (Array.isArray(provider && provider.windows) ? provider.windows : [])
    .filter((win) => win && Number.isFinite(Number(win.remainingPct)));
  const preferred = windows.filter((win) => quotaRank(win) < 5).sort((a, b) => quotaRank(a) - quotaRank(b));
  const chosen = (preferred.length ? preferred : windows).slice(0, 3);
  if (chosen.length) return chosen;
  if (provider && provider.status === "ok" && Number.isFinite(Number(provider.remainingPct))) {
    return [{ id: "primary", label: "잔여", remainingPct: Number(provider.remainingPct), resetAt: provider.resetAt }];
  }
  return [];
}

function renderCompactQuotas(provider) {
  const windows = compactQuotaWindows(provider);
  if (!windows.length) return "";
  return `<div class="compact-quotas">${windows.map((win) => `
    <div class="compact-quota">
      <span>${escapeHtml(win.label || "한도")}</span>
      <span class="track"><i style="--pct:${Number(win.remainingPct) || 0}; --tone:${tone(win.remainingPct)};"></i></span>
      <b>${pctLabel(win.remainingPct)}%</b>
    </div>
  `).join("")}</div>`;
}

function measuredUsagePct(source) {
  const used = Number(source && source.usedPct);
  if (Number.isFinite(used)) return used;
  const remaining = Number(source && source.remainingPct);
  if (Number.isFinite(remaining)) return 100 - remaining;
  return null;
}

function aiUsageIsZero(provider) {
  if (!provider || provider.status !== "ok") return false;
  const windows = Array.isArray(provider.windows) ? provider.windows : [];
  const measured = windows.map(measuredUsagePct).filter((value) => value != null);
  if (measured.length) return measured.every((value) => value === 0);
  const providerUsage = measuredUsagePct(provider);
  if (providerUsage != null) return providerUsage === 0;
  return true;
}

function heldCreditBalances(provider) {
  const balances = Array.isArray(provider.creditBalances) ? provider.creditBalances : [];
  return balances.filter((balance) => {
    if (!balance || !creditBalanceText(balance)) return false;
    if (balance.unlimited === true) return true;
    const remaining = Number(balance.balance);
    if (Number.isFinite(remaining)) return remaining > 0;
    const pct = Number(balance.remainingPct);
    return Number.isFinite(pct) && pct > 0;
  }).slice(0, 3);
}

function compactCreditBalances(provider) {
  const balances = heldCreditBalances(provider);
  if (aiUsageIsZero(provider)) return balances;
  // Codex workspace credits and prepaid balances are a separate pool from the
  // 5-hour or weekly meter. Keep those visible after the included quota is used.
  return balances.filter((balance) => !Number.isFinite(Number(balance.remainingPct)));
}

function renderCompactCredits(provider) {
  const balances = compactCreditBalances(provider);
  if (!balances.length) return "";
  return `<div class="compact-quotas compact-credits">${balances.map((balance) => {
    const amount = creditBalanceText(balance);
    const pct = Number(balance.remainingPct);
    const track = Number.isFinite(pct)
      ? `<span class="track"><i style="--pct:${pct}; --tone:${tone(pct)};"></i></span>`
      : "";
    return `<div class="compact-quota compact-credit"><span>${escapeHtml(balance.label || "크레딧")}</span>${track}<b>${escapeHtml(amount)}</b></div>`;
  }).join("")}</div>`;
}

function renderProviderCard(provider) {
  const plan = provider.plan ? ` · ${provider.plan}` : "";
  const account = !compact && provider.accountLabel ? ` · ${provider.accountLabel}` : "";
  const providerKey = baseProviderId(provider);
  const fiveHour = fiveHourWindow(provider);
  const resetLabel = resetText(provider.resetAt);
  const quotaWindows = compact ? [] : (provider.windows || []);
  const showQuotaVisuals = quotaWindows.length >= 2;
  const showFiveInStatus = (providerKey === "claude" || providerKey === "codex") && fiveHour && !showQuotaVisuals;
  const statusLine =
    provider.status === "ok"
      ? (showFiveInStatus
        ? `5시간 ${pctLabel(fiveHour.remainingPct)}%${resetLabel ? ` · ${resetLabel}` : ""}`
        : resetLabel)
      : provider.status === "login"
        ? "로그인 필요"
        : provider.status === "missing"
          ? "계정 없음"
          : provider.error || "오류";
  const maxExtras = Number.isFinite(Number(provider.maxExtras)) ? Math.max(0, Number(provider.maxExtras)) : 4;
  const extras = (provider.extras || [])
    .filter((item) => item.label !== "리셋 쿠폰")
    .filter((item) => String(item.value || "").length < 36)
    .slice(0, compact ? 0 : maxExtras)
    .map((item) => `<span class="chip">${item.label} ${item.value}</span>`)
    .join("");
  const quotaChips = showQuotaVisuals
    ? ""
    : quotaWindows.map((win) => `<span class="chip">${win.label} ${pctLabel(win.remainingPct)}%</span>`).join("");
  const chips = `${quotaChips}${extras}`;
  const credits = compact ? "" : renderCreditBalances(provider);
  const facts = compact ? "" : renderAccountMeta(provider);
  const hint = provider.status !== "ok" && provider.hint ? `<div class="hint">${provider.hint}</div>` : "";
  const cardAttrs = ` data-provider-id="${escapeHtml(providerKey)}"${isPinned(provider) ? ` data-pinned="true" data-pin-key="${escapeHtml(pinKey(provider))}" draggable="true"` : ""}`;

  if (compact) {
    const compactStatus = provider.status === "ok"
      ? ""
      : provider.status === "login"
        ? "로그인 필요"
        : provider.status === "missing"
          ? "계정 없음"
          : provider.error || "오류";
    return `
      <article class="row compact"${cardAttrs}>
        <div class="meta">
          ${renderProviderTitle(provider, "", plan)}
          ${compactStatus ? `<div class="sub">${compactStatus}${provider.stale ? " · 이전 값" : ""}</div>` : ""}
          ${renderCompactQuotas(provider)}
          ${renderCompactCredits(provider)}
          ${hint}
        </div>
      </article>
    `;
  }

  if (showQuotaVisuals) {
    return `
      <article class="row multi-quota visual-${visualization}"${cardAttrs}>
        <div class="meta">
          ${renderProviderTitle(provider, account, plan)}
          <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
          <div class="quota-visuals quota-${visualization}s">${quotaWindows.map(renderQuotaVisual).join("")}</div>
          ${facts}
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
    <article class="row visual-${visualization} ${compact ? "compact" : ""}"${cardAttrs}>
      ${renderSummaryVisual(provider)}
      <div class="meta">
        ${renderProviderTitle(provider, account, plan)}
        <div class="sub">${statusLine}${provider.stale ? " · 이전 값" : ""}</div>
        ${facts}
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
  pinnedAccounts = Array.isArray(settings.pinnedAccounts) ? settings.pinnedAccounts.map((item) => String(item || "").toLowerCase()) : [];
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

  const pinned = [];
  const rest = [];
  for (const provider of providers) {
    if (isPinned(provider)) pinned.push(provider);
    else rest.push(provider);
  }
  pinned.sort((a, b) => pinnedAccounts.indexOf(pinKey(a)) - pinnedAccounts.indexOf(pinKey(b)));
  const sections = [];
  if (pinned.length) sections.push({ vendor: "고정", providers: pinned, reorderable: true });
  sections.push(...groupProviders(rest));
  listEl.innerHTML = sections.map((group) => `
    <section class="provider-group"${group.reorderable ? ' data-pin-group="true"' : ""}>
      <div class="provider-group-head">
        <span>${group.vendor}</span>
        ${group.reorderable ? '<small class="pin-order-hint">드래그로 순서</small>' : ""}
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

function reorderPinnedAccounts(keys, fromKey, toKey) {
  const list = (Array.isArray(keys) ? keys : []).map((item) => String(item || "").toLowerCase());
  const from = list.indexOf(fromKey);
  const to = list.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function clearPinDragState() {
  pinDragKey = "";
  listEl.querySelectorAll(".pin-dragging, .pin-drop-target").forEach((el) => {
    el.classList.remove("pin-dragging", "pin-drop-target");
  });
}

let pinDragKey = "";

listEl.addEventListener("dragstart", (event) => {
  const card = event.target.closest("article[data-pin-key]");
  if (!card) return;
  if (event.target.closest("button, a, input, textarea, select")) {
    event.preventDefault();
    return;
  }
  pinDragKey = String(card.dataset.pinKey || "").toLowerCase();
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", pinDragKey);
  }
  card.classList.add("pin-dragging");
});

listEl.addEventListener("dragover", (event) => {
  const card = event.target.closest("article[data-pin-key]");
  if (!card) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  listEl.querySelectorAll(".pin-drop-target").forEach((el) => {
    if (el !== card) el.classList.remove("pin-drop-target");
  });
  card.classList.add("pin-drop-target");
});

listEl.addEventListener("dragleave", (event) => {
  const card = event.target.closest("article[data-pin-key]");
  if (card && !card.contains(event.relatedTarget)) card.classList.remove("pin-drop-target");
});

listEl.addEventListener("drop", async (event) => {
  const card = event.target.closest("article[data-pin-key]");
  if (!card || !lastPayload) return;
  event.preventDefault();
  const fromKey = String((event.dataTransfer && event.dataTransfer.getData("text/plain")) || pinDragKey || "").toLowerCase();
  const toKey = String(card.dataset.pinKey || "").toLowerCase();
  clearPinDragState();
  if (!fromKey || !toKey || fromKey === toKey) return;
  const next = reorderPinnedAccounts(pinnedAccounts, fromKey, toKey);
  if (next.join("\n") === pinnedAccounts.join("\n")) return;
  try {
    const settings = await window.tokenWidget.saveSettings({ pinnedAccounts: next });
    render({ ...lastPayload, settings });
  } catch {
    render(lastPayload);
  }
});

listEl.addEventListener("dragend", () => {
  clearPinDragState();
});

listEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".pin-btn");
  if (!button || !lastPayload) return;
  event.preventDefault();
  event.stopPropagation();
  const key = String(button.dataset.pinKey || "").toLowerCase();
  if (!key) return;
  const current = Array.isArray(pinnedAccounts) ? pinnedAccounts : [];
  const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current];
  button.disabled = true;
  try {
    const settings = await window.tokenWidget.saveSettings({ pinnedAccounts: next });
    render({ ...lastPayload, settings });
  } finally {
    button.disabled = false;
  }
});

window.tokenWidget.onUsage(render);
window.tokenWidget.getSettings().then((settings) => {
  fillSettings(settings);
  requestResize();
});
window.addEventListener("resize", requestResize);