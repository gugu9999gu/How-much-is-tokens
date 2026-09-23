const { parseTime } = require("./time");

function cleanLabel(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function billingCycle({
  renewsAt = null,
  startedAt = null,
  label = "결제일",
  note = null,
  status = null,
  source = null,
} = {}) {
  const renew = parseTime(renewsAt);
  const start = parseTime(startedAt);
  const text = typeof note === "string" && note.trim() ? note.trim() : null;
  const state = typeof status === "string" && status.trim() ? status.trim() : null;
  if (!renew && !start && !text) return null;
  return {
    renewsAt: renew,
    startedAt: start,
    label: cleanLabel(label, "결제일"),
    note: text,
    status: state,
    source: source || null,
  };
}

module.exports = {
  billingCycle,
};
