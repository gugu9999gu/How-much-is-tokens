const { spawnSync } = require("child_process");
const path = require("path");

function normalizeRows(rows) {
  return (rows || []).map((row) => ({
    key: row.key,
    value: Buffer.isBuffer(row.value) ? row.value.toString("utf8") : String(row.value ?? ""),
  }));
}

function queryItemTable(dbPath, like) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE ?").all(like);
    db.close();
    return normalizeRows(rows);
  } catch {
    const helper = path.join(__dirname, "vscdb-query.js");
    const result = spawnSync(
      process.env.TOKEN_WIDGET_NODE || "node",
      ["--experimental-sqlite", helper, dbPath, like],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    if (result.status === 0 && result.stdout) {
      return JSON.parse(result.stdout);
    }
    const err = (result.stderr || result.error || "sqlite 조회 실패").toString().trim();
    throw new Error(err || "sqlite 조회 실패");
  }
}

function mapByKey(rows) {
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

module.exports = { queryItemTable, mapByKey };
