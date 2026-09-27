function planWindowRank(win) {
  const text = `${win && win.id || ""} ${win && win.label || ""}`.toLowerCase();
  if (/week|seven[_ -]?day|7\s*day|주간/.test(text)) return 7;
  if (/month|월간|billing|결제 주기/.test(text)) return 30;
  return 0;
}

function planRenewalFromWindows(windows) {
  const renewals = (Array.isArray(windows) ? windows : [])
    .filter((win) => win && Number.isFinite(Number(win.resetAt)) && Number(win.resetAt) > 0 && planWindowRank(win) >= 7)
    .sort((a, b) => Number(a.resetAt) - Number(b.resetAt) || planWindowRank(b) - planWindowRank(a));
  const next = renewals[0];
  if (!next) return null;
  return {
    renewsAt: Number(next.resetAt),
    label: "한도 갱신",
    windowLabel: next.label ? String(next.label) : "주간 한도",
    source: "plan-window",
  };
}

function withPlanRenewal(provider) {
  if (!provider || typeof provider !== "object") return provider;
  if (provider.billing && provider.billing.renewsAt) return provider;
  const renewal = planRenewalFromWindows(provider.windows);
  if (!renewal) return provider;
  return { ...provider, accessRenewal: renewal };
}

module.exports = {
  planWindowRank,
  planRenewalFromWindows,
  withPlanRenewal,
};
