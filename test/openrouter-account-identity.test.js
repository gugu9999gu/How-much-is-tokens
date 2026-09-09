const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  OPENROUTER_CURRENT_KEY_URL,
  creatorUserIdFromPayload,
  creatorUserIdForApiKey,
  findExistingOpenRouterAccount,
} = require("../lib/openrouter-account-identity");

assert.strictEqual(
  creatorUserIdFromPayload({ data: { creator_user_id: "user_2dHFtVWx2n56w6HkM0000000000" } }),
  "user_2dHFtVWx2n56w6HkM0000000000",
);
assert.strictEqual(creatorUserIdFromPayload({ data: {} }), null);

const integration = fs.readFileSync(path.join(__dirname, "..", "lib", "openrouter-main-integration.js"), "utf8");
assert.ok(integration.includes("duplicateOpenRouterAccount"), "OAuth flow must invoke the account-identity duplicate guard");
assert.ok(integration.includes('reason: "duplicate-account"'), "duplicate OAuth account must return an explicit duplicate-account result");
assert.ok(integration.includes("selection.isNew !== true"), "duplicate rejection must apply only to +account OAuth, preserving normal reconnect behavior");
assert.ok(
  integration.indexOf("duplicateOpenRouterAccount(selection, apiKey)") < integration.indexOf("saveOpenRouterProfileSecrets(selection.profile.id"),
  "duplicate-account check must happen before persisting the new OAuth key",
);

const profiles = [
  { id: "primary", label: "OpenRouter 1", priority: 10, enabled: true },
  { id: "other", label: "OpenRouter 2", priority: 20, enabled: true },
];
const keys = {
  primary: { apiKey: "key-primary" },
  other: { apiKey: "key-other" },
};

async function requestFixture(url, init) {
  assert.strictEqual(url, OPENROUTER_CURRENT_KEY_URL);
  const bearer = String(init && init.headers && init.headers.Authorization || "");
  const creator = bearer.endsWith("key-primary")
    ? "user-primary"
    : bearer.endsWith("key-other")
      ? "user-other"
      : bearer.endsWith("key-new-same")
        ? "user-primary"
        : bearer.endsWith("key-new-unique")
          ? "user-new"
          : null;
  if (!creator) return { ok: false, status: 401 };
  return { ok: true, status: 200, json: { data: { creator_user_id: creator } } };
}

(async () => {
  assert.strictEqual(
    await creatorUserIdForApiKey("key-new-same", { requestJsonImpl: requestFixture }),
    "user-primary",
  );

  const duplicate = await findExistingOpenRouterAccount(profiles, "user-primary", {
    loadProfileSecrets: (profileId) => keys[profileId],
    requestJsonImpl: requestFixture,
  });
  assert.ok(duplicate);
  assert.strictEqual(duplicate.id, "primary", "new OAuth key from an already connected OpenRouter user must resolve to the existing profile");

  const unique = await findExistingOpenRouterAccount(profiles, "user-new", {
    loadProfileSecrets: (profileId) => keys[profileId],
    requestJsonImpl: requestFixture,
  });
  assert.strictEqual(unique, null);

  const excluded = await findExistingOpenRouterAccount(profiles, "user-primary", {
    excludeProfileId: "primary",
    loadProfileSecrets: (profileId) => keys[profileId],
    requestJsonImpl: requestFixture,
  });
  assert.strictEqual(excluded, null, "reconnecting a profile must not compare the profile against itself");

  assert.strictEqual(await creatorUserIdForApiKey("", { requestJsonImpl: requestFixture }), null);
  console.log("OpenRouter OAuth account identity tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
