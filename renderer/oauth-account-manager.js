const oauthAccountStyle = document.createElement("link");
oauthAccountStyle.rel = "stylesheet";
oauthAccountStyle.href = "oauth-account-manager.css";
document.head.appendChild(oauthAccountStyle);

const OAUTH_ACCOUNT_PROVIDERS = ["codex", "claude", "grok", "cursor", "copilot", "antigravity"];
let oauthAccountRefreshQueued = false;

function accountCard(providerId) {
  return document.querySelector(`[data-connection-provider="${providerId}"]`);
}

function accountStatusElement(providerId) {
  return document.querySelector(`[data-connection-status="${providerId}"]`);
}

function accountHost(providerId) {
  const card = accountCard(providerId);
  if (!card) return null;
  let host = card.querySelector(".oauth-account-host");
  if (host) return host;
  host = document.createElement("div");
  host.className = "oauth-account-host";
  host.dataset.oauthAccounts = providerId;
  card.appendChild(host);
  return host;
}

function smallButton(label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `oauth-account-action ${className}`.trim();
  button.textContent = label;
  return button;
}

function accountExpiryText(expiresAt) {
  const time = Number(expiresAt);
  if (!Number.isFinite(time)) return "";
  const delta = time - Date.now();
  if (delta <= 0) return "만료됨";
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) return `${Math.max(1, hours)}시간 후 갱신`;
  return `${Math.ceil(hours / 24)}일 후 갱신`;
}

async function setActiveAccount(providerId, slotId, button) {
  button.disabled = true;
  try {
    await window.tokenWidget.useProviderAccount(providerId, slotId);
    await refreshOAuthAccounts(providerId);
    await window.tokenWidget.refresh();
  } catch (error) {
    if (typeof setConnectionMessage === "function") setConnectionMessage(error.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function reauthAccount(providerId, slotId, button) {
  button.disabled = true;
  if (typeof setConnectionMessage === "function") setConnectionMessage(`${providerId} 계정을 재인증하는 중...`);
  try {
    const result = await window.tokenWidget.reauthProviderAccount(providerId, slotId);
    if (!result || !result.ok) throw new Error((result && (result.error || result.reason)) || "재인증 실패");
    await refreshOAuthAccounts(providerId);
    await window.tokenWidget.refresh();
    if (typeof setConnectionMessage === "function") setConnectionMessage("계정 재인증이 완료되었습니다.");
  } catch (error) {
    if (typeof setConnectionMessage === "function") setConnectionMessage(error.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function removeAccount(providerId, slotId, label, button) {
  const confirmed = window.confirm(`${label || "이 계정"} 연결을 삭제할까요?\n저장된 OAuth 자격증명만 삭제하며 공급자 계정 자체는 삭제하지 않습니다.`);
  if (!confirmed) return;
  button.disabled = true;
  try {
    await window.tokenWidget.removeProviderAccount(providerId, slotId);
    await refreshOAuthAccounts(providerId);
    await window.tokenWidget.refresh();
    if (typeof setConnectionMessage === "function") setConnectionMessage("저장된 계정 연결을 삭제했습니다.");
  } catch (error) {
    if (typeof setConnectionMessage === "function") setConnectionMessage(error.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

function renderOAuthAccounts(providerId, accounts) {
  const host = accountHost(providerId);
  if (!host) return;
  host.replaceChildren();
  const rows = Array.isArray(accounts) ? accounts : [];

  if (!rows.length) {
    host.classList.add("empty");
    return;
  }
  host.classList.remove("empty");

  const details = document.createElement("details");
  details.className = "oauth-account-list";
  const summary = document.createElement("summary");
  const active = rows.find((row) => row.active) || rows[0];
  summary.textContent = rows.length > 1
    ? `${active.label} · 계정 ${rows.length}개`
    : active.label;
  details.appendChild(summary);

  const list = document.createElement("div");
  list.className = "oauth-account-rows";
  rows.forEach((account) => {
    const row = document.createElement("div");
    row.className = `oauth-account-row${account.active ? " active" : ""}${account.needsReauth ? " reauth" : ""}`;

    const copy = document.createElement("div");
    copy.className = "oauth-account-copy";
    const label = document.createElement("b");
    label.textContent = account.label || "계정";
    const state = document.createElement("small");
    const expiry = accountExpiryText(account.expiresAt);
    state.textContent = account.needsReauth
      ? "재인증 필요"
      : [account.active ? "활성" : "대기", expiry].filter(Boolean).join(" · ");
    copy.append(label, state);

    const actions = document.createElement("div");
    actions.className = "oauth-account-actions";
    if (!account.active && !account.needsReauth) {
      const use = smallButton("사용", "primary");
      use.addEventListener("click", () => setActiveAccount(providerId, account.slotId, use));
      actions.appendChild(use);
    }
    const reauth = smallButton("재인증");
    reauth.addEventListener("click", () => reauthAccount(providerId, account.slotId, reauth));
    actions.appendChild(reauth);
    const remove = smallButton("삭제", "danger");
    remove.addEventListener("click", () => removeAccount(providerId, account.slotId, account.label, remove));
    actions.appendChild(remove);

    row.append(copy, actions);
    list.appendChild(row);
  });
  details.appendChild(list);
  host.appendChild(details);

  const status = accountStatusElement(providerId);
  if (status) {
    const usable = rows.filter((row) => !row.needsReauth);
    status.className = `connection-status ${usable.length ? "connected" : "attention"}`;
    status.textContent = usable.length
      ? (rows.length > 1 ? `연결됨 · ${rows.length}개` : "연결됨")
      : "재인증 필요";
  }
}

async function refreshOAuthAccounts(providerId = null) {
  if (typeof window.tokenWidget.listProviderAccounts !== "function") return;
  const ids = providerId ? [providerId] : OAUTH_ACCOUNT_PROVIDERS;
  await Promise.all(ids.map(async (id) => {
    try {
      const rows = await window.tokenWidget.listProviderAccounts(id);
      renderOAuthAccounts(id, rows);
      if (id === "cursor") {
        const grokBot = accountCard("grokbot");
        const status = accountStatusElement("grokbot");
        if (grokBot) grokBot.classList.toggle("shared-oauth-connected", Array.isArray(rows) && rows.length > 0);
        if (status && Array.isArray(rows) && rows.length > 0) {
          status.className = "connection-status connected";
          status.textContent = `Cursor 공유 · ${rows.length}개`;
        }
      }
    } catch {
      // Usage status remains the fallback if account metadata cannot be read.
    }
  }));
  window.dispatchEvent(new Event("resize"));
}

function queueOAuthAccountRefresh() {
  if (oauthAccountRefreshQueued) return;
  oauthAccountRefreshQueued = true;
  setTimeout(() => {
    oauthAccountRefreshQueued = false;
    refreshOAuthAccounts().catch(() => {});
  }, 30);
}

refreshOAuthAccounts().catch(() => {});
window.tokenWidget.onUsage(() => queueOAuthAccountRefresh());
