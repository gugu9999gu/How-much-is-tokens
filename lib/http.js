async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { method, headers, signal: controller.signal };
    if (body != null) {
      init.body = typeof body === "string" || body instanceof URLSearchParams ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      json: null,
      text: "",
      error: aborted ? "요청 시간 초과" : err.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function num(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value.val != null) return num(value.val);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPct(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

module.exports = { requestJson, pick, num, clampPct };
