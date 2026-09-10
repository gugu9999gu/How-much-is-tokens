const fs = require("fs");
const file = "lib/cli-maintenance.js";
let text = fs.readFileSync(file, "utf8");
function replace(before, after, label) {
  if (!text.includes(before)) throw new Error(`missing ${label}`);
  text = text.replace(before, after);
}
replace(
  '    latestCommand: ["update", "--check"],\n    updateArgs: ["update"],',
  '    latestCommand: ["update", "--check"],\n    latestParser: "grok-update-check",\n    updateArgs: ["update"],',
  "Grok parser spec",
);
replace(
  'function versionParts(value) {',
  `function versionFromGrokUpdateCheck(value) {
  const match = String(value || "").match(/latest:\\s*v?([0-9]+(?:\\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/i);
  return match ? match[1] : extractVersion(value);
}

function versionParts(value) {`,
  "Grok update parser",
);
replace(
  '    return result.ok ? extractVersion(`${result.stdout}\\n${result.stderr}`) : null;',
  '    if (!result.ok) return null;\n    const output = `${result.stdout}\\n${result.stderr}`;\n    return spec.latestParser === "grok-update-check" ? versionFromGrokUpdateCheck(output) : extractVersion(output);',
  "command latest parser dispatch",
);
replace(
  '  extractVersion,\n  compareVersions,',
  '  extractVersion,\n  versionFromGrokUpdateCheck,\n  compareVersions,',
  "Grok parser export",
);
fs.writeFileSync(file, text);
