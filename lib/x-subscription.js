// List prices and included-usage multiples published for The X Subscription
// and legacy Cursor plans. These are catalog prices, not an account invoice.
// https://docs.x.ai/x-subscription/pricing
// https://cursor.com/docs/models-and-pricing
// https://cursor.com/help/account-and-billing/pricing
// https://prod.cursor.com/docs/account/pricing/legacy-cursor-plans
// https://cursor.com/help/grok-bot/plans
// https://docs.x.ai/x-subscription/grok-bot

const X_SUBSCRIPTION = {
  free: {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    annualUsd: 0,
    included: "Limited",
    grokBotIncluded: false,
    grokBotExcluded: true,
  },
  plus: {
    id: "plus",
    name: "Plus",
    monthlyUsd: 8,
    annualUsd: 80,
    annualMonthlyUsd: 7,
    included: "Base",
    grokBotIncluded: false,
    grokBotExcluded: true,
  },
  premium: {
    id: "premium",
    name: "Premium",
    monthlyUsd: 30,
    annualUsd: 300,
    annualMonthlyUsd: 25,
    included: "4x Plus",
    grokBotIncluded: true,
  },
  super: {
    id: "super",
    name: "Super",
    monthlyUsd: 100,
    annualUsd: 1000,
    annualMonthlyUsd: 84,
    included: "15x Plus",
    grokBotIncluded: true,
  },
};

const X_SUBSCRIPTION_ULTRA = {
  id: "ultra",
  name: "Ultra",
  monthlyUsd: 200,
  annualUsd: 2000,
  annualMonthlyUsd: 167,
  included: "50x Plus",
  grokBotIncluded: true,
};

const LEGACY_CURSOR = {
  hobby: {
    id: "hobby",
    name: "Hobby",
    monthlyUsd: 0,
    includedPools: "cursor-models",
    grokBotIncluded: false,
  },
  start: {
    id: "start",
    name: "Start",
    monthlyInr: 649,
    taxInclusive: true,
    includedPools: "cursor-models",
    grokBotIncluded: true,
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyUsd: 20,
    includedPools: "both",
    grokBotIncluded: true,
  },
  "pro+": {
    id: "pro+",
    name: "Pro+",
    monthlyUsd: 60,
    includedPools: "both",
    grokBotIncluded: true,
  },
  "teams standard": {
    id: "teams-standard",
    name: "Teams Standard",
    monthlyUsd: 40,
    perSeat: true,
    includedPools: "both",
    grokBotIncluded: true,
  },
  "teams premium": {
    id: "teams-premium",
    name: "Teams Premium",
    monthlyUsd: 120,
    perSeat: true,
    includedPools: "both",
    grokBotIncluded: true,
  },
};

const LEGACY_CURSOR_ULTRA = {
  id: "ultra",
  name: "Ultra",
  monthlyUsd: 200,
  includedPools: "both",
  grokBotIncluded: true,
};

function normalizePlanKey(raw) {
  let key = String(raw || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  key = key.replace(/^cursor\s+/, "");
  if (key === "pro plus" || key === "proplus") return "pro+";
  if (key === "super grok") return "supergrok";
  if (key === "super grok plus" || key === "supergrok plus" || key === "supergrok+") return "supergrok plus";
  if (key === "super grok heavy" || key === "supergrok heavy") return "supergrok heavy";
  if (key === "super grok lite" || key === "supergrok lite") return "supergrok lite";
  if (key === "team standard") return "teams standard";
  if (key === "team premium") return "teams premium";
  return key;
}

function legacyGrokName(key) {
  switch (key) {
    case "supergrok":
      return "SuperGrok";
    case "supergrok plus":
      return "SuperGrok Plus";
    case "supergrok heavy":
      return "SuperGrok Heavy";
    case "supergrok lite":
      return "SuperGrok Lite";
    default:
      return null;
  }
}

function describePlan(raw) {
  const key = normalizePlanKey(raw);
  if (!key) return null;
  const legacyGrok = legacyGrokName(key);
  if (legacyGrok) {
    return {
      id: key,
      name: legacyGrok,
      family: "legacy-grok",
      grokBotIncluded: key !== "supergrok lite",
      grokBotExcluded: key === "supergrok lite",
    };
  }
  if (key === "ultra") {
    return {
      id: "ultra",
      name: "Ultra",
      family: "ambiguous",
      monthlyUsd: 200,
      xSubscription: X_SUBSCRIPTION_ULTRA,
      legacyCursor: LEGACY_CURSOR_ULTRA,
    };
  }
  if (Object.prototype.hasOwnProperty.call(X_SUBSCRIPTION, key)) {
    return {
      ...X_SUBSCRIPTION[key],
      family: "x-subscription",
      usageReset: "weekly",
      extraUsage: "top-up",
      thirdPartyIncluded: false,
    };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_CURSOR, key)) {
    return {
      ...LEGACY_CURSOR[key],
      family: "legacy-cursor",
      usageReset: "monthly",
      extraUsage: key === "hobby" || key === "start" ? "none" : "on-demand",
      thirdPartyIncluded: LEGACY_CURSOR[key].includedPools === "both",
    };
  }
  return null;
}

function listPriceText(quote) {
  if (quote.monthlyUsd != null) {
    return `$${quote.monthlyUsd}${quote.perSeat ? "/인" : ""}`;
  }
  if (quote.monthlyInr != null) return `₹${quote.monthlyInr}`;
  return "";
}

function badgeIncluded(quote) {
  switch (quote.id) {
    case "free":
      return "Limited";
    case "plus":
      return "Base";
    case "premium":
      return "4x";
    case "super":
      return "15x";
    default:
      return "";
  }
}

function formatPlanLabel(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  const quote = describePlan(text);
  if (!quote || quote.family === "ambiguous" || quote.family === "legacy-grok") return text;
  const included = quote.family === "x-subscription" ? badgeIncluded(quote) : "";
  return [quote.name, listPriceText(quote), included].filter(Boolean).join(" · ");
}

function isXSubscription(raw) {
  const quote = typeof raw === "string" ? describePlan(raw) : raw;
  return !!(quote && quote.family === "x-subscription");
}

module.exports = {
  X_SUBSCRIPTION,
  X_SUBSCRIPTION_ULTRA,
  LEGACY_CURSOR,
  LEGACY_CURSOR_ULTRA,
  describePlan,
  formatPlanLabel,
  isXSubscription,
  normalizePlanKey,
};
