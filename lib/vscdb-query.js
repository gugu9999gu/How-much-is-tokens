const { DatabaseSync } = require("node:sqlite");

const dbPath = process.argv[2];
const like = process.argv[3] || "cursorAuth%";
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE ?").all(like);
const out = rows.map((row) => ({
  key: row.key,
  value: Buffer.isBuffer(row.value) ? row.value.toString("utf8") : String(row.value ?? ""),
}));
db.close();
process.stdout.write(JSON.stringify(out));
