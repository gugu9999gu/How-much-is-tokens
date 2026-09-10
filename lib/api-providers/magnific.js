const { runApiProvider } = require("./common");
const { parseTime, formatClock } = require("../time");

const ID = "magnific";
const NAME = "Magnific";
const BRAND = "#a855f7";
const RECENT_URL = "https://api.magnific.com/v1/creations/recent?per_page=5";

function statusKo(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed": return "완료";
    case "failed": return "실패";
    case "processing":
    case "in_progress": return "처리 중";
    case "queued": return "대기";
    default: return status ? String(status) : "";
  }
}

function parse(json) {
  const items = json && Array.isArray(json.data) ? json.data : null;
  if (!items) return null;
  const logs = items.slice(0, 5).map((item) => {
    const creation = item && item.creation && typeof item.creation === "object" ? item.creation : {};
    const label = item.tool_name || creation.tool || item.name || creation.family || "생성";
    const sub = [statusKo(creation.status), formatClock(parseTime(item.created_at))].filter(Boolean).join(" · ");
    return { label, sub };
  });
  return {
    extras: [{ label: "최근 생성", value: `${items.length}건` }],
    logs,
    logsTitle: "최근 생성",
  };
}

const definition = {
  id: ID,
  name: NAME,
  brand: BRAND,
  vendor: "생성형 미디어",
  vendorOrder: 80,
  serviceOrder: 30,
  detail: "최근 생성 / 사용 현황",
  credentials: [{ key: "apiKey", label: "API Key", placeholder: "x-magnific-api-key" }],
  missingHint: "설정 > 생성형 미디어 API에서 Magnific(또는 Freepik) API Key를 저장하세요.",
  parse,
};

function fetchUsage(_settings, _secrets, profile = null) {
  return runApiProvider(definition, {
    url: () => RECENT_URL,
    headers: (creds) => ({ "x-magnific-api-key": creds.apiKey, Accept: "application/json" }),
    parse,
  }, profile);
}

module.exports = { ...definition, fetchUsage, parse };
