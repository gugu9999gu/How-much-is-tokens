function parseTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
  }
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? n : n * 1000;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function formatReset(ms) {
  if (ms == null) return "";
  const delta = ms - Date.now();
  if (delta <= 0) return "곧 리셋";
  const minutes = Math.round(delta / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}일 ${hours}시간 후`;
  if (hours > 0) return `${hours}시간 ${mins}분 후`;
  return `${Math.max(1, mins)}분 후`;
}

function formatClock(ms) {
  if (ms == null) return "";
  const d = new Date(ms);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hh}:${mm}`;
}

function remainingFromUsed(usedPct) {
  if (usedPct == null) return null;
  return Math.max(0, Math.min(100, 100 - usedPct));
}

module.exports = { parseTime, formatReset, formatClock, remainingFromUsed };
