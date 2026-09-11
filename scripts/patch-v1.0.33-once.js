const fs = require("fs");

function patch(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`Expected patch anchor not found in ${path}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Patch did not change ${path}`);
  fs.writeFileSync(path, next, "utf8");
}

patch(
  "preload.js",
  'for (const src of ["widget-enhancements.js", "account-identity-ui.js", "account-automation-v2.js", "openrouter-profile-ui.js"]) {',
  'for (const src of ["widget-enhancements.js", "account-identity-ui.js", "account-automation-v2.js", "openrouter-profile-ui.js", "card-pins-autoheight.js"]) {',
);

patch(
  "lib/antigravity-account-manager.js",
  `    const remainingValues = windows.map((row) => Number(row.remainingPct)).filter(Number.isFinite);\n    const remainingPct = remainingValues.length ? Math.min(...remainingValues) : null;\n    const resets = windows.map((row) => Number(row.resetAt)).filter((value) => Number.isFinite(value) && value > 0);`,
  `    const geminiWindows = windows.filter((row) => /gemini/i.test(\`${'${row.id || ""} ${row.label || ""}'}\`));\n    const summaryPool = geminiWindows.length ? geminiWindows : windows;\n    const primary = [...summaryPool]\n      .filter((row) => Number.isFinite(Number(row.remainingPct)))\n      .sort((a, b) => Number(a.remainingPct) - Number(b.remainingPct) || (Number(a.resetAt) || Infinity) - (Number(b.resetAt) || Infinity))[0] || null;\n    const remainingPct = primary ? Number(primary.remainingPct) : null;`,
);

patch(
  "lib/antigravity-account-manager.js",
  `      resetAt: resets.length ? Math.min(...resets) : null,`,
  `      resetAt: primary && Number.isFinite(Number(primary.resetAt)) && Number(primary.resetAt) > 0 ? Number(primary.resetAt) : null,`,
);

patch(
  "package.json",
  'electron test/media-provider-ui-smoke.js --disable-gpu",',
  'electron test/media-provider-ui-smoke.js --disable-gpu && electron test/card-pins-autoheight-smoke.js --disable-gpu",',
);

patch(
  ".github/workflows/build-windows.yml",
  `          node --check renderer/account-identity-ui.js\n`,
  `          node --check renderer/account-identity-ui.js\n          node --check renderer/card-pins-autoheight.js\n`,
);

patch(
  ".github/workflows/build-windows.yml",
  `          node --check test/secure-secrets-smoke.js\n`,
  `          node --check test/secure-secrets-smoke.js\n          node --check test/card-pins-autoheight-preload.js\n          node --check test/card-pins-autoheight-smoke.js\n`,
);

console.log("v1.0.33 one-time source patch applied");
