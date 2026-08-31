const { fetchAll } = require("./usage");

function line(provider) {
  const pct =
    provider.remainingPct == null
      ? "--"
      : `${Math.round(provider.remainingPct)}%`;
  const status = provider.status === "ok" ? pct : provider.status;
  const plan = provider.plan ? ` ${provider.plan}` : "";
  return `${provider.name}${plan}: ${status}${provider.hint ? ` — ${provider.hint}` : ""}`;
}

fetchAll({}).then((result) => {
  for (const provider of result.providers) {
    console.log(line(provider));
    for (const win of provider.windows || []) {
      const left = win.remainingPct;
      console.log(`  - ${win.label}: 남은 ${left == null ? "-" : Math.round(left)}%`);
    }
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
