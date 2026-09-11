(() => {
  const api = window.tokenWidget;
  if (!api) return;

  let usagePayload = typeof api.getLastUsage === "function" ? api.getLastUsage() : null;
  let syncQueued = false;

  function clean(value) {
    return value == null ? "" : String(value).trim();
  }

  function identityText(row) {
    if (!row) return "";
    const email = clean(row.accountEmail);
    const login = clean(row.accountLogin);
    const accountId = clean(row.accountId);
    const label = clean(row.accountIdentityLabel);
    const parts = [];
    if (email) parts.push(email);
    if (login && login !== email) parts.push(login);
    if (accountId && accountId !== email && accountId !== login) parts.push(`ID ${accountId}`);
    if (!parts.length && label) parts.push(label);
    return parts.join(" · ");
  }

  function visibleRows(payload) {
    const providers = Array.isArray(payload && payload.providers) ? payload.providers : [];
    const hideMissing = !(payload && payload.settings && payload.settings.hideMissing === false);
    return hideMissing ? providers.filter((row) => row && row.status !== "missing") : providers;
  }

  function syncTokenCardIdentities() {
    const list = document.getElementById("list");
    if (!list || !usagePayload) return;
    const cards = [...list.querySelectorAll("article.row")];
    const rows = visibleRows(usagePayload);
    if (cards.length !== rows.length) return;

    cards.forEach((card, index) => {
      const row = rows[index];
      const meta = card.querySelector(".meta");
      if (!meta) return;
      const text = identityText(row);
      let line = meta.querySelector(":scope > .account-identity-line");
      if (!text) {
        if (line) line.remove();
        return;
      }
      if (!line) {
        line = document.createElement("div");
        line.className = "account-identity-line";
        const heading = meta.querySelector(":scope > .provider-title, :scope > b");
        if (heading && heading.nextSibling) meta.insertBefore(line, heading.nextSibling);
        else if (heading) meta.appendChild(line);
        else meta.prepend(line);
      }
      if (line.textContent !== text) line.textContent = text;
      line.title = text;
    });
  }

  function identityForDuplicate(item) {
    return identityText(item) || clean(item && item.accountLabel) || "해당 계정";
  }

  function announceDeduplicatedAccounts(payload) {
    const duplicates = Array.isArray(payload && payload.deduplicatedAccounts) ? payload.deduplicatedAccounts : [];
    if (!duplicates.length) return;
    const message = document.getElementById("connectionHubMessage");
    if (!message) return;
    const first = duplicates[0];
    const suffix = duplicates.length > 1 ? ` 외 ${duplicates.length - 1}개` : "";
    message.textContent = `${identityForDuplicate(first)}${suffix}는 이미 등록된 계정이라 추가 계정으로 저장하지 않았습니다.`;
    message.classList.remove("warning");
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      syncTokenCardIdentities();
    });
  }

  const list = document.getElementById("list");
  if (list && typeof MutationObserver === "function") {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(list, { childList: true, subtree: true });
    window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  }

  if (typeof api.onUsage === "function") {
    api.onUsage((payload) => {
      usagePayload = payload;
      announceDeduplicatedAccounts(payload);
      scheduleSync();
    });
  }

  scheduleSync();
})();
