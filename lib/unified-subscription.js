const { describePlan, formatPlanLabel } = require("./x-subscription");

const SEPARATE_IDS = new Set(["cursor", "grok", "grokbot"]);

function sharedWindow(grok, grokbot) {
  const grokWindow = grok && (grok.windows || []).find((win) => win && (win.id === "weekly" || win.id === "monthly" || win.id === "shared"));
  const botWindow = grokbot && (grokbot.windows || []).find((win) => win && win.id === "weekly");
  const source = grok && grok.unified === true && grokWindow ? grokWindow : botWindow || grokWindow;
  if (!source || source.remainingPct == null) return null;
  return {
    id: "shared",
    label: "공유 주간 한도",
    usedPct: source.usedPct,
    remainingPct: source.remainingPct,
    resetAt: source.resetAt,
  };
}

function membershipOf(provider) {
  if (!provider) return null;
  if (typeof provider.membership === "string" && provider.membership.trim()) return provider.membership.trim();
  return null;
}

function includedProducts(membership) {
  const quote = describePlan(membership);
  const names = ["Cursor", "Grok"];
  if (!quote || quote.grokBotIncluded !== false) names.push("Grok Bot");
  return names.join(" · ");
}

function productExtras(grok) {
  return (grok && grok.extras || []).filter((item) => item && item.label && item.value);
}

function combineUnifiedSubscription(providers) {
  const list = Array.isArray(providers) ? providers.filter(Boolean) : [];
  const cursor = list.find((item) => item.id === "cursor" && item.status === "ok");
  const grok = list.find((item) => item.id === "grok" && item.status === "ok");
  const grokbot = list.find((item) => item.id === "grokbot" && item.status === "ok");
  const unified = (grok && grok.unified === true) || (grokbot && grokbot.unified === true);
  if (!unified) return list;

  const window = sharedWindow(grok, grokbot);
  const membership = membershipOf(grokbot) || membershipOf(cursor);
  const plan = (membership && formatPlanLabel(membership)) || (grokbot && grokbot.plan) || (cursor && cursor.plan) || null;
  const prepaid = (grok && grok.creditBalances || []).filter((item) => item && item.id === "prepaid");
  const extras = [...productExtras(grok)];
  extras.push({ label: "포함", value: includedProducts(membership) });

  const card = {
    id: "x-subscription",
    name: "X Subscription",
    brand: "#d6d6d6",
    status: "ok",
    plan,
    membership,
    unified: true,
    remainingPct: window ? window.remainingPct : null,
    usedPct: window ? window.usedPct : null,
    resetAt: window ? window.resetAt : null,
    windows: window ? [window] : [],
    creditBalances: prepaid,
    billing: grok && grok.billing && grok.billing.renewsAt ? grok.billing : null,
    extras,
    vendor: "xAI",
    vendorOrder: 40,
    serviceOrder: 15,
  };

  return list
    .filter((item) => !SEPARATE_IDS.has(item.id))
    .concat(card);
}

module.exports = {
  combineUnifiedSubscription,
  sharedWindow,
};
