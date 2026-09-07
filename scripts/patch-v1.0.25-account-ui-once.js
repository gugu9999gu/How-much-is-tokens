const fs = require("fs");

function read(file) { return fs.readFileSync(file, "utf8"); }
function write(file, text) { fs.writeFileSync(file, text, "utf8"); }
function replaceOne(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return text.replace(before, after);
}

// Load masked account manager after the base connection hub.
{
  const file = "renderer/index.html";
  let text = read(file);
  text = replaceOne(text,
    '    <script src="connection-settings.js"></script>\n',
    '    <script src="connection-settings.js"></script>\n    <script src="oauth-account-manager.js"></script>\n',
    "renderer account manager script",
  );
  write(file, text);
}

// Stable-identity OAuth providers can all add accounts directly; Grok Bot shares Cursor.
{
  const file = "renderer/connection-settings.js";
  let text = read(file);
  for (const [provider, detail] of [
    ["cursor", "Cursor 계정"],
    ["copilot", "GitHub OAuth"],
    ["antigravity", "Google 계정"],
  ]) {
    text = replaceOne(text,
      `{ id: "${provider}", label: "${provider === "cursor" ? "Cursor" : provider === "copilot" ? "Copilot" : "Antigravity"}", detail: "${detail}", multi: false }`,
      `{ id: "${provider}", label: "${provider === "cursor" ? "Cursor" : provider === "copilot" ? "Copilot" : "Antigravity"}", detail: "${detail}", multi: true }`,
      `${provider} multi OAuth flag`,
    );
  }
  write(file, text);
}

// Mark app-managed OAuth result rows so CLI Smart Routing never selects a credential it cannot export.
{
  const file = "lib/usage.js";
  let text = read(file);
  text = replaceOne(text,
`    next.accountLabel = profile.label;\n    next.instanceKey = instanceKey;`,
`    next.accountLabel = profile.label;\n    next.instanceKey = instanceKey;\n    if (profile.oauthManaged) next.credentialManaged = true;`,
    "usage credential-managed marker",
  );
  write(file, text);
}

{
  const file = "lib/account-router.js";
  let text = read(file);
  text = replaceOne(text,
`  return providers\n    .filter((row) => rowProviderId(row) === providerId)`,
`  return providers\n    .filter((row) => rowProviderId(row) === providerId && row.credentialManaged !== true)`,
    "router exclude app OAuth accounts",
  );
  write(file, text);
}

// Renderer smoke preload exposes metadata-only account APIs. No raw OAuth token exists in this fixture.
{
  const file = "test/renderer-layout-preload.js";
  let text = read(file);
  const marker = 'const listeners = new Set();\n';
  const fixture = `const oauthAccounts = {\n  codex: [\n    { providerId: "codex", slotId: "fixture-codex-1", label: "d***r@example.com", active: true, needsReauth: false, expiresAt: Date.now() + 3600000, hasRefresh: true },\n    { providerId: "codex", slotId: "fixture-codex-2", label: "w***k@example.com", active: false, needsReauth: false, expiresAt: Date.now() + 7200000, hasRefresh: true },\n  ],\n  cursor: [\n    { providerId: "cursor", slotId: "fixture-cursor-1", label: "c***r@example.com", active: true, needsReauth: false, expiresAt: Date.now() + 3600000, hasRefresh: true },\n  ],\n};\n`;
  text = replaceOne(text, marker, marker + fixture, "renderer oauth metadata fixture");
  text = replaceOne(text,
`  addCredentialAccount: async (providerId) => ({ ok: false, providerId, reason: "profiles-not-supported" }),\n  routeLaunch:`,
`  addCredentialAccount: async (providerId) => ({ ok: false, providerId, reason: "profiles-not-supported" }),\n  listProviderAccounts: async (providerId) => (oauthAccounts[providerId] || []).map((row) => ({ ...row })),\n  useProviderAccount: async (providerId, slotId) => {\n    const rows = oauthAccounts[providerId] || [];\n    rows.forEach((row) => { row.active = row.slotId === slotId; });\n    return rows.map((row) => ({ ...row }));\n  },\n  reauthProviderAccount: async (providerId, slotId) => ({ ok: true, providerId, slotId, accounts: (oauthAccounts[providerId] || []).map((row) => ({ ...row })) }),\n  removeProviderAccount: async (providerId, slotId) => {\n    oauthAccounts[providerId] = (oauthAccounts[providerId] || []).filter((row) => row.slotId !== slotId);\n    if (oauthAccounts[providerId].length && !oauthAccounts[providerId].some((row) => row.active)) oauthAccounts[providerId][0].active = true;\n    return oauthAccounts[providerId].map((row) => ({ ...row }));\n  },\n  routeLaunch:`,
    "renderer account manager API fixture",
  );
  write(file, text);
}

// Smoke confirms account labels are masked metadata and advanced settings stay collapsed.
{
  const file = "test/renderer-layout-smoke.js";
  let text = read(file);
  text = replaceOne(text,
    '    await wait(120);\n\n    const connectionUi',
    '    await wait(180);\n\n    const connectionUi',
    "renderer wait for oauth metadata",
  );
  text = replaceOne(text,
`        codexStatus: document.querySelector('[data-connection-status="codex"]')?.textContent || '',\n      };`,
`        codexStatus: document.querySelector('[data-connection-status="codex"]')?.textContent || '',\n        codexAccountSummary: document.querySelector('[data-oauth-accounts="codex"] summary')?.textContent || '',\n        cursorAccountSummary: document.querySelector('[data-oauth-accounts="cursor"] summary')?.textContent || '',\n        rawCredentialControls: document.querySelectorAll('[data-oauth-token], [data-access-token], [data-refresh-token]').length,\n      };`,
    "renderer oauth account sample",
  );
  text = replaceOne(text,
`    assert.ok(connectionUi.codexStatus.includes("연결됨"), "connection hub should render latest provider state");`,
`    assert.ok(connectionUi.codexStatus.includes("연결됨"), "connection hub should render latest provider state");\n    assert.ok(connectionUi.codexAccountSummary.includes("계정 2개"), "managed OAuth account count should render without raw tokens");\n    assert.ok(connectionUi.codexAccountSummary.includes("@example.com"), "masked OAuth identity should be visible");\n    assert.ok(connectionUi.cursorAccountSummary.includes("@example.com"), "Cursor managed OAuth identity should render");\n    assert.strictEqual(connectionUi.rawCredentialControls, 0, "renderer must not expose OAuth token controls");`,
    "renderer oauth assertions",
  );
  write(file, text);
}

console.log("v1.0.25 masked OAuth account UI patch applied");