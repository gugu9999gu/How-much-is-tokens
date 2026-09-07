const fs = require("fs");

function read(file) { return fs.readFileSync(file, "utf8"); }
function write(file, text) { fs.writeFileSync(file, text, "utf8"); }
function replaceOne(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return text.replace(before, after);
}

// main.js: decrypt/refresh OAuth credentials in main only and inject ephemeral memory into usage.
{
  const file = "main.js";
  let text = read(file);
  text = replaceOne(text,
    'require("./lib/openrouter-main-integration");\nconst { fetchAll } = require("./lib/usage");',
    'require("./lib/openrouter-main-integration");\nconst { loadUsableOAuthSecrets } = require("./lib/provider-auth-main");\nconst { fetchAll } = require("./lib/usage");',
    "main auth-manager import",
  );
  text = replaceOne(text,
    '    const settings = loadSettings();\n    const result = await fetchAll(settings);',
    '    const settings = loadSettings();\n    const oauthSecrets = await loadUsableOAuthSecrets();\n    const result = await fetchAll(settings, oauthSecrets);',
    "main OAuth secret injection",
  );
  write(file, text);
}

// usage.js: internally-managed OAuth accounts become ordinary per-account cards without exposing credentials.
{
  const file = "lib/usage.js";
  let text = read(file);
  const marker = 'async function fetchAll(settings = {}, secrets = {}) {\n';
  const helper = `function oauthProfilesForProvider(secrets = {}, credentialProviderId, displayProviderId = credentialProviderId) {\n  const rows = secrets && secrets.oauthAccounts && Array.isArray(secrets.oauthAccounts[credentialProviderId])\n    ? secrets.oauthAccounts[credentialProviderId]\n    : [];\n  return rows.map((row) => ({\n    id: \`oauth-\${row.slotId}\`,\n    providerId: displayProviderId,\n    label: row.label || "OAuth 계정",\n    enabled: true,\n    oauthManaged: true,\n    oauthSlotId: row.slotId,\n    oauthNeedsReauth: row.needsReauth === true,\n    oauthRefreshError: row.refreshError || null,\n    authCredential: row.credential || null,\n  }));\n}\n\n`;
  text = replaceOne(text, marker, helper + marker, "usage oauth helper");
  text = replaceOne(text,
`    const profiles = byProvider.get(provider.id) || [];\n    jobs.push(safeFetch(provider, settings, secrets, null, profiles.length ? "기본 계정" : null, 0));\n    profiles.forEach((profile, index) => {\n      jobs.push(safeFetch(provider, settings, secrets, profile, null, index + 1));\n    });`,
`    const profiles = byProvider.get(provider.id) || [];\n    const credentialProviderId = provider.id === "grokbot" ? "cursor" : provider.id;\n    const oauthProfiles = oauthProfilesForProvider(secrets, credentialProviderId, provider.id);\n\n    if (oauthProfiles.length) {\n      oauthProfiles.forEach((profile, index) => {\n        jobs.push(safeFetch(provider, settings, secrets, profile, null, index));\n      });\n      // Explicit legacy CLI profiles remain as an advanced fallback, but the\n      // default local credential is skipped while this app owns OAuth accounts\n      // to avoid duplicate cards for the same identity.\n      profiles.forEach((profile, index) => {\n        jobs.push(safeFetch(provider, settings, secrets, profile, null, oauthProfiles.length + index));\n      });\n    } else {\n      jobs.push(safeFetch(provider, settings, secrets, null, profiles.length ? "기본 계정" : null, 0));\n      profiles.forEach((profile, index) => {\n        jobs.push(safeFetch(provider, settings, secrets, profile, null, index + 1));\n      });\n    }`,
    "usage provider account expansion",
  );
  text = replaceOne(text,
    '  profileMap,\n};',
    '  profileMap,\n  oauthProfilesForProvider,\n};',
    "usage export oauth helper",
  );
  write(file, text);
}

// Codex: app-owned OAuth accounts use WHAM directly; never mix in the machine's local app-server/reset-ticket account.
{
  const file = "lib/providers/codex.js";
  let text = read(file);
  text = replaceOne(text,
`  const runtimeEnv = profileEnvironment(profile);\n  let auth = readJson(authPath(profile));\n  let tokens = auth && auth.tokens;`,
`  const runtimeEnv = profileEnvironment(profile);\n  const managedCredential = profile && profile.oauthManaged ? profile.authCredential : null;\n  if (profile && profile.oauthManaged && (profile.oauthNeedsReauth || !managedCredential || !managedCredential.access)) {\n    return {\n      id: ID,\n      name: NAME,\n      brand: BRAND,\n      status: "login",\n      hint: "이 Codex 계정은 앱에서 재인증이 필요합니다.",\n    };\n  }\n  let auth = managedCredential\n    ? { tokens: { access_token: managedCredential.access, account_id: managedCredential.accountId || null } }\n    : readJson(authPath(profile));\n  let tokens = auth && auth.tokens;`,
    "codex managed credential",
  );
  text = replaceOne(text,
    '  if (res.status === 401 || res.status === 403) {\n    refresh = await refreshManagedAuth({ env: runtimeEnv });',
    '  if (!managedCredential && (res.status === 401 || res.status === 403)) {\n    refresh = await refreshManagedAuth({ env: runtimeEnv });',
    "codex avoid local refresh for managed oauth",
  );
  text = replaceOne(text,
    '  let rateLimitsRead = await readAccountRateLimits({ env: runtimeEnv });',
    '  let rateLimitsRead = managedCredential ? { ok: false, reason: "app-oauth-account" } : await readAccountRateLimits({ env: runtimeEnv });',
    "codex avoid local app server contamination",
  );
  write(file, text);
}

// Claude: prefer app-owned OAuth credential over ~/.claude and keep raw token in process memory only.
{
  const file = "lib/providers/claude.js";
  let text = read(file);
  text = replaceOne(text,
`  const file = readJson(credentialsPath(profile));\n  const oauth = file && file.claudeAiOauth;`,
`  const managedCredential = profile && profile.oauthManaged ? profile.authCredential : null;\n  if (profile && profile.oauthManaged && (profile.oauthNeedsReauth || !managedCredential || !managedCredential.access)) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Claude 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const file = managedCredential ? null : readJson(credentialsPath(profile));\n  const oauth = managedCredential\n    ? { accessToken: managedCredential.access, accountUuid: managedCredential.accountId, email: managedCredential.email }\n    : file && file.claudeAiOauth;`,
    "claude managed credential",
  );
  write(file, text);
}

// Grok: prefer internally refreshed xAI OAuth account.
{
  const file = "lib/providers/grok.js";
  let text = read(file);
  text = replaceOne(text,
`  const auth = pickAuth(profile);\n  if (!auth) {`,
`  const managedCredential = profile && profile.oauthManaged ? profile.authCredential : null;\n  if (profile && profile.oauthManaged && (profile.oauthNeedsReauth || !managedCredential || !managedCredential.access)) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Grok 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const auth = managedCredential\n    ? { token: managedCredential.access, userId: managedCredential.accountId }\n    : pickAuth(profile);\n  if (!auth) {`,
    "grok managed credential",
  );
  write(file, text);
}

// Cursor auth helper: accept an app-owned OAuth JWT before local IDE/session discovery.
{
  const file = "lib/providers/cursor-auth.js";
  let text = read(file);
  text = replaceOne(text,
`function getCursorAuth(settings = {}) {\n  const configuredCookie = String(settings.cursorCookie || "").trim();`,
`function getCursorAuth(settings = {}, oauthCredential = null) {\n  if (oauthCredential && oauthCredential.access) {\n    const token = String(oauthCredential.access);\n    const claims = decodeJwt(token);\n    const cookieValue = cookieFromJwt(token);\n    return {\n      token,\n      cookie: \`WorkosCursorSessionToken=\${cookieValue}\`,\n      userId: oauthCredential.accountId || (claims && claims.sub ? String(claims.sub).split("|").pop() : null),\n      membership: null,\n      source: "app-oauth",\n    };\n  }\n  const configuredCookie = String(settings.cursorCookie || "").trim();`,
    "cursor injected oauth",
  );
  write(file, text);
}

// Cursor provider uses per-account injected credential.
{
  const file = "lib/providers/cursor.js";
  let text = read(file);
  text = replaceOne(text,
    'async function fetchUsage(settings) {\n  const auth = getCursorAuth(settings || {});',
    'async function fetchUsage(settings, _secrets = {}, profile = null) {\n  if (profile && profile.oauthManaged && profile.oauthNeedsReauth) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Cursor 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const auth = getCursorAuth(settings || {}, profile && profile.oauthManaged ? profile.authCredential : null);',
    "cursor provider managed auth",
  );
  write(file, text);
}

// Grok Bot shares the same Cursor OAuth account pool.
{
  const file = "lib/providers/grokbot.js";
  let text = read(file);
  text = replaceOne(text,
    'async function fetchUsage(settings) {\n  const auth = getCursorAuth(settings || {});',
    'async function fetchUsage(settings, _secrets = {}, profile = null) {\n  if (profile && profile.oauthManaged && profile.oauthNeedsReauth) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "공유 Cursor 계정의 재인증이 필요합니다." };\n  }\n  const auth = getCursorAuth(settings || {}, profile && profile.oauthManaged ? profile.authCredential : null);',
    "grokbot shared managed cursor auth",
  );
  write(file, text);
}

// Copilot usage endpoint needs the durable GitHub OAuth access, not the short-lived Copilot inference token.
{
  const file = "lib/providers/copilot.js";
  let text = read(file);
  text = replaceOne(text,
`function findToken(settings) {\n  const pasted = (settings.githubToken || "").trim();`,
`function findToken(settings, oauthCredential = null) {\n  const managed = String((oauthCredential && (oauthCredential.githubAccess || oauthCredential.refresh)) || "").trim();\n  if (managed) return { token: managed, source: "앱 OAuth" };\n  const pasted = (settings.githubToken || "").trim();`,
    "copilot managed token",
  );
  text = replaceOne(text,
`async function fetchUsage(settings) {\n  const creds = findToken(settings);`,
`async function fetchUsage(settings, _secrets = {}, profile = null) {\n  if (profile && profile.oauthManaged && profile.oauthNeedsReauth) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 GitHub/Copilot 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const creds = findToken(settings, profile && profile.oauthManaged ? profile.authCredential : null);`,
    "copilot provider managed auth",
  );
  write(file, text);
}

// Antigravity: direct OAuth accounts query Google's fixed quota host; agy remains local fallback.
{
  const file = "lib/providers/antigravity.js";
  let text = read(file);
  const insertionMarker = 'async function fetchUsage() {\n';
  const directCode = `function asRecord(value) {\n  return value && typeof value === "object" && !Array.isArray(value) ? value : null;\n}\n\nfunction antigravityRemainingPct(raw) {\n  const row = asRecord(raw);\n  if (!row) return null;\n  const target = asRecord(row.remaining) || row;\n  const fraction = Number(target.remainingFraction);\n  const percentage = Number(target.remainingPercentage);\n  const remaining = Number.isFinite(fraction)\n    ? fraction * 100\n    : Number.isFinite(percentage)\n      ? percentage * 100\n      : null;\n  return remaining == null ? null : Math.max(0, Math.min(100, remaining));\n}\n\nfunction parseAntigravitySummary(body) {\n  const groups = Array.isArray(body && body.groups) ? body.groups : [];\n  const windows = new Map();\n  for (const rawGroup of groups) {\n    const group = asRecord(rawGroup);\n    if (!group) continue;\n    const groupName = \`\${String(group.displayName || "")} \${String(group.description || "")}\`.toLowerCase();\n    const family = groupName.includes("gemini") ? "Gemini"\n      : (groupName.includes("claude") || groupName.includes("3p") || groupName.includes("gpt")) ? "Claude/GPT"\n        : String(group.displayName || "기타");\n    for (const rawBucket of Array.isArray(group.buckets) ? group.buckets : []) {\n      const bucket = asRecord(rawBucket);\n      if (!bucket) continue;\n      const remainingPct = antigravityRemainingPct(bucket);\n      if (remainingPct == null) continue;\n      const descriptor = \`\${String(bucket.window || "")} \${String(bucket.bucketId || "")} \${String(bucket.displayName || "")}\`.toLowerCase();\n      const suffix = descriptor.includes("week") ? "주간 한도" : (descriptor.includes("5h") || descriptor.includes("five")) ? "5시간 한도" : "한도";\n      const label = \`\${family} \${suffix}\`;\n      if (windows.has(label)) continue;\n      windows.set(label, {\n        id: label.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-"),\n        label,\n        remainingPct,\n        usedPct: 100 - remainingPct,\n        resetAt: parseTime(bucket.resetTime),\n        source: "antigravity-oauth-quota-summary",\n      });\n    }\n  }\n  return [...windows.values()];\n}\n\nfunction quotaInfoEntries(modelInfo) {\n  const rows = [];\n  const add = (value, tier = "") => {\n    const row = asRecord(value);\n    if (row) rows.push(tier ? { ...row, tier } : row);\n  };\n  if (Array.isArray(modelInfo.quotaInfo)) modelInfo.quotaInfo.forEach((value) => add(value));\n  else add(modelInfo.quotaInfo);\n  if (Array.isArray(modelInfo.quotaInfos)) modelInfo.quotaInfos.forEach((value) => add(value));\n  const byTier = asRecord(modelInfo.quotaInfoByTier);\n  if (byTier) Object.entries(byTier).forEach(([tier, value]) => {\n    if (Array.isArray(value)) value.forEach((item) => add(item, tier));\n    else add(value, tier);\n  });\n  return rows;\n}\n\nfunction parseAntigravityModels(body) {\n  const models = asRecord(body && body.models);\n  if (!models) return [];\n  const windows = new Map();\n  for (const [modelId, rawInfo] of Object.entries(models)) {\n    const info = asRecord(rawInfo);\n    if (!info) continue;\n    for (const quota of quotaInfoEntries(info)) {\n      const haystack = \`\${modelId} \${String(info.displayName || "")} \${String(quota.tier || "")}\`.toLowerCase();\n      const family = haystack.includes("gemini") ? "Gemini"\n        : (haystack.includes("claude") || haystack.includes("opus") || haystack.includes("sonnet") || haystack.includes("gpt")) ? "Claude/GPT" : null;\n      if (!family || windows.has(family)) continue;\n      const remainingPct = antigravityRemainingPct(quota);\n      if (remainingPct == null) continue;\n      windows.set(family, {\n        id: family === "Gemini" ? "gemini" : "3p",\n        label: \`\${family} 한도\`,\n        remainingPct,\n        usedPct: 100 - remainingPct,\n        resetAt: parseTime(quota.resetTime),\n        source: "antigravity-oauth-models",\n      });\n    }\n  }\n  return [...windows.values()];\n}\n\nasync function antigravityOAuthRequest(url, credential) {\n  const response = await fetch(url, {\n    method: "POST",\n    headers: {\n      Authorization: \`Bearer \${credential.access}\`,\n      Accept: "application/json",\n      "Content-Type": "application/json",\n      "User-Agent": "antigravity/ide/2.5.5",\n    },\n    body: JSON.stringify({ project: credential.projectId }),\n    redirect: "error",\n    signal: AbortSignal.timeout(15000),\n  });\n  const json = await response.json().catch(() => null);\n  return { ok: response.ok, status: response.status, json };\n}\n\nasync function fetchOAuthUsage(profile) {\n  const credential = profile && profile.authCredential;\n  if (!credential || !credential.access || !credential.projectId) {\n    return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Antigravity 계정은 앱에서 재인증이 필요합니다." };\n  }\n  const base = "https://daily-cloudcode-pa.googleapis.com";\n  try {\n    const summary = await antigravityOAuthRequest(\`\${base}/v1internal:retrieveUserQuotaSummary\`, credential);\n    if (summary.status === 401 || summary.status === 403) {\n      return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "Antigravity OAuth 인증 갱신이 필요합니다." };\n    }\n    let windows = summary.ok ? parseAntigravitySummary(summary.json) : [];\n    if (!windows.length) {\n      const models = await antigravityOAuthRequest(\`\${base}/v1internal:fetchAvailableModels\`, credential);\n      if (models.status === 401 || models.status === 403) {\n        return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "Antigravity OAuth 인증 갱신이 필요합니다." };\n      }\n      windows = models.ok ? parseAntigravityModels(models.json) : [];\n    }\n    if (!windows.length) {\n      return { id: ID, name: NAME, brand: BRAND, status: "error", error: "Antigravity quota를 읽지 못했습니다." };\n    }\n    const primary = tightest(windows);\n    return {\n      id: ID,\n      name: NAME,\n      brand: BRAND,\n      status: "ok",\n      remainingPct: primary ? primary.remainingPct : null,\n      usedPct: primary ? primary.usedPct : null,\n      resetAt: primary ? primary.resetAt : null,\n      windows,\n      extras: [{ label: "인증", value: "앱 OAuth" }],\n      stale: false,\n    };\n  } catch (error) {\n    return { id: ID, name: NAME, brand: BRAND, status: "error", error: error.message || String(error) };\n  }\n}\n\n`;
  text = replaceOne(text, insertionMarker, directCode + 'async function fetchUsage(_settings = {}, _secrets = {}, profile = null) {\n  if (profile && profile.oauthManaged) {\n    if (profile.oauthNeedsReauth) return { id: ID, name: NAME, brand: BRAND, status: "login", hint: "이 Antigravity 계정은 앱에서 재인증이 필요합니다." };\n    return fetchOAuthUsage(profile);\n  }\n', "antigravity direct oauth insertion");
  text = replaceOne(text,
    '  snapshotContext,\n};',
    '  snapshotContext,\n  antigravityRemainingPct,\n  parseAntigravitySummary,\n  parseAntigravityModels,\n  fetchOAuthUsage,\n};',
    "antigravity oauth exports",
  );
  write(file, text);
}

// Preload: default auth becomes main-process OAuth; CLI auth remains an explicit advanced fallback.
{
  const file = "preload.js";
  let text = read(file);
  text = replaceOne(text,
`async function connectCredential(providerId, options = {}) {\n  const id = String(providerId || "").toLowerCase();\n  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", options || {});\n  const settings = await ipcRenderer.invoke("get-settings");\n  const profileId = String((options && options.profileId) || "");\n  const profile = profileId ? findProfile(settings, id, profileId) : null;\n  return launchCredentialLogin(id, profile);\n}\n\nasync function addCredentialAccount(providerId) {\n  const id = String(providerId || "").toLowerCase();\n  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", { createNew: true });\n  if (!PROFILE_LOGIN_PROVIDERS.has(id)) {\n    return { ok: false, providerId: id, reason: "profiles-not-supported" };\n  }\n\n  const settings = await ipcRenderer.invoke("get-settings");\n  const proposal = nextManagedProfile(settings, id);\n  if (!proposal) return { ok: false, providerId: id, reason: "profiles-not-supported" };\n  ensureProfileDirectory(proposal);\n\n  const merged = [...normalizeAccountProfiles(settings.accountProfiles), proposal];\n  const saved = await ipcRenderer.invoke("save-settings", { accountProfiles: merged });\n  const profile = normalizeAccountProfiles(saved.accountProfiles)\n    .find((item) => item.providerId === id && item.configDir === proposal.configDir);\n  if (!profile) return { ok: false, providerId: id, reason: "profile-save-failed" };\n\n  const result = launchCredentialLogin(id, profile);\n  return {\n    ...result,\n    accountProfilesText: formatAccountProfilesForUi(saved.accountProfiles),\n  };\n}`,
`async function connectCredential(providerId, options = {}) {\n  const id = String(providerId || "").toLowerCase();\n  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", options || {});\n  return ipcRenderer.invoke("provider-oauth-login", id, { ...options, addAccount: false });\n}\n\nasync function addCredentialAccount(providerId) {\n  const id = String(providerId || "").toLowerCase();\n  if (id === "openrouter") return ipcRenderer.invoke("connect-openrouter-oauth", { createNew: true });\n  return ipcRenderer.invoke("provider-oauth-login", id, { addAccount: true });\n}\n\nasync function connectCredentialFallback(providerId, options = {}) {\n  const id = String(providerId || "").toLowerCase();\n  const settings = await ipcRenderer.invoke("get-settings");\n  const profileId = String((options && options.profileId) || "");\n  const profile = profileId ? findProfile(settings, id, profileId) : null;\n  return launchCredentialLogin(id, profile);\n}\n\nasync function addCredentialAccountFallback(providerId) {\n  const id = String(providerId || "").toLowerCase();\n  if (!PROFILE_LOGIN_PROVIDERS.has(id)) return { ok: false, providerId: id, reason: "profiles-not-supported" };\n  const settings = await ipcRenderer.invoke("get-settings");\n  const proposal = nextManagedProfile(settings, id);\n  if (!proposal) return { ok: false, providerId: id, reason: "profiles-not-supported" };\n  ensureProfileDirectory(proposal);\n  const merged = [...normalizeAccountProfiles(settings.accountProfiles), proposal];\n  const saved = await ipcRenderer.invoke("save-settings", { accountProfiles: merged });\n  const profile = normalizeAccountProfiles(saved.accountProfiles).find((item) => item.providerId === id && item.configDir === proposal.configDir);\n  if (!profile) return { ok: false, providerId: id, reason: "profile-save-failed" };\n  return { ...launchCredentialLogin(id, profile), accountProfilesText: formatAccountProfilesForUi(saved.accountProfiles) };\n}`,
    "preload direct oauth login",
  );
  text = replaceOne(text,
`  connectCredential,\n  addCredentialAccount,\n  routeLaunch,`,
`  connectCredential,\n  addCredentialAccount,\n  connectCredentialFallback,\n  addCredentialAccountFallback,\n  listProviderAccounts: (providerId) => ipcRenderer.invoke("list-provider-oauth-credentials", providerId),\n  useProviderAccount: (providerId, slotId) => ipcRenderer.invoke("set-active-provider-oauth-credential", providerId, slotId),\n  removeProviderAccount: (providerId, slotId) => ipcRenderer.invoke("remove-provider-oauth-credential", providerId, slotId),\n  reauthProviderAccount: (providerId, slotId) => ipcRenderer.invoke("provider-oauth-login", providerId, { slotId, reauth: true }),\n  routeLaunch,`,
    "preload account manager API",
  );
  write(file, text);
}

console.log("v1.0.25 OAuth account-manager integration patch applied");