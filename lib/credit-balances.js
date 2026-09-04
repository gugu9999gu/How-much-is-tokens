function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function amountFromMinor(value, exponent = 2) {
  const amount = finiteNumber(value);
  const exp = finiteNumber(exponent);
  if (amount == null) return null;
  const divisor = Math.pow(10, exp == null ? 2 : Math.max(0, Math.min(9, Math.trunc(exp))));
  return amount / divisor;
}

function amountFromObject(value, defaultExponent = 2) {
  if (value == null) return null;
  if (typeof value !== "object") return finiteNumber(value);
  const minor = value.amount_minor ?? value.amountMinor ?? value.val ?? value.value;
  if (minor == null) return null;
  const exponent = value.exponent ?? value.currency_exponent ?? value.currencyExponent ?? defaultExponent;
  return amountFromMinor(minor, exponent);
}

function remainingPercent(balance, limit) {
  const b = finiteNumber(balance);
  const l = finiteNumber(limit);
  if (b == null || l == null || l <= 0) return null;
  return Math.max(0, Math.min(100, (Math.max(0, b) / l) * 100));
}

function safeCreditBalance(raw) {
  if (!raw || typeof raw !== "object") return null;
  const balance = finiteNumber(raw.balance);
  const used = finiteNumber(raw.used);
  const limit = finiteNumber(raw.limit);
  if (balance == null && used == null && limit == null && raw.unlimited !== true) return null;
  return {
    id: raw.id == null ? "credits" : String(raw.id),
    label: raw.label == null ? "크레딧" : String(raw.label),
    balance,
    used,
    limit,
    currency: raw.currency == null ? null : String(raw.currency).toUpperCase(),
    unit: raw.unit == null ? null : String(raw.unit),
    remainingPct: finiteNumber(raw.remainingPct),
    resetAt: finiteNumber(raw.resetAt),
    unlimited: raw.unlimited === true,
    source: raw.source == null ? undefined : String(raw.source),
  };
}

module.exports = {
  finiteNumber,
  amountFromMinor,
  amountFromObject,
  remainingPercent,
  safeCreditBalance,
};
