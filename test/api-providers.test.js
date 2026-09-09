const assert = require("assert");

const falai = require("../lib/api-providers/falai");
const higgsfield = require("../lib/api-providers/higgsfield");
const magnific = require("../lib/api-providers/magnific");
const elevenlabs = require("../lib/api-providers/elevenlabs");
const stability = require("../lib/api-providers/stability");
const { API_PROVIDERS, apiProviderById, apiProviderCatalog, apiProviderMeta } = require("../lib/api-providers/registry");
const { PROVIDERS, PROVIDER_META } = require("../lib/usage");

// --- fal.ai: prepaid credit balance -----------------------------------------
const fal = falai.parse({ username: "my-team", credits: { current_balance: 42.5, currency: "usd" } });
assert.ok(fal, "fal.ai billing should parse");
assert.strictEqual(fal.plan, "my-team");
assert.strictEqual(fal.creditBalances[0].balance, 42.5);
assert.strictEqual(fal.creditBalances[0].currency, "USD");
assert.strictEqual(falai.parse({}), null, "fal.ai without credits is unusable");

// --- ElevenLabs: character quota window --------------------------------------
const el = elevenlabs.parse({ tier: "creator", character_count: 32000, character_limit: 100000, next_character_count_reset_unix: 1798761600 });
assert.ok(el, "ElevenLabs subscription should parse");
assert.strictEqual(el.plan, "creator");
assert.strictEqual(Math.round(el.remainingPct), 68);
assert.strictEqual(el.creditBalances[0].balance, 68000);
assert.strictEqual(el.creditBalances[0].used, 32000);
assert.ok(el.windows[0].resetAt > 1e12, "reset unix seconds convert to ms");
assert.strictEqual(elevenlabs.parse({ character_limit: 0, character_count: 0 }), null);

// --- Stability AI: credit balance --------------------------------------------
assert.strictEqual(stability.parse({ credits: 980.5 }).creditBalances[0].balance, 980.5);
assert.strictEqual(stability.parse({ credits: 980.5 }).creditBalances[0].unit, "크레딧");
assert.strictEqual(stability.parse({}), null);

// --- Magnific: recent creations become a usage log ---------------------------
const mg = magnific.parse({
  data: [
    { tool_name: "text-to-image", created_at: "2026-05-01T12:30:00Z", creation: { status: "completed", tool: "text-to-image" } },
    { name: "night", created_at: "2026-05-01T11:00:00Z", creation: { status: "failed" } },
  ],
});
assert.ok(mg, "Magnific creations should parse");
assert.strictEqual(mg.logs.length, 2);
assert.strictEqual(mg.logs[0].label, "text-to-image");
assert.ok(mg.logs[0].sub.includes("완료"));
assert.ok(mg.logs[1].sub.includes("실패"));
assert.strictEqual(mg.extras[0].value, "2건");
assert.strictEqual(magnific.parse({}), null, "non-array data is unusable");
assert.strictEqual(magnific.parse({ data: [] }).logs.length, 0);

// --- Higgsfield: tolerant balance parsing + graceful gaps --------------------
const hf = higgsfield.parse({ email: "a@b.com", credits: { balance: 120, limit: 500 } });
assert.ok(hf, "Higgsfield account should parse");
assert.strictEqual(hf.account, "a@b.com");
assert.strictEqual(hf.creditBalance.balance, 120);
assert.strictEqual(hf.creditBalance.limit, 500);
assert.strictEqual(Math.round(hf.creditBalance.remainingPct), 24);
assert.strictEqual(higgsfield.parse({ credits: 77 }).creditBalance.balance, 77);
assert.strictEqual(higgsfield.parse({ subscription: { credits_remaining: 9 } }).creditBalance.balance, 9);
assert.strictEqual(higgsfield.parse({}), null, "no balance field is unusable");

// --- Without stored credentials every provider is a no-network "missing" -----
(async () => {
  for (const provider of [falai, higgsfield, magnific, elevenlabs, stability]) {
    const result = await provider.fetchUsage({}, {}, null);
    assert.strictEqual(result.status, "missing", `${provider.id} must be missing without credentials`);
    assert.strictEqual(result.id, provider.id);
    assert.ok(result.hint, `${provider.id} should explain how to connect`);
  }

  // --- Registry + usage wiring -----------------------------------------------
  const catalog = apiProviderCatalog();
  assert.strictEqual(catalog.length, API_PROVIDERS.length);
  for (const id of ["falai", "higgsfield", "magnific", "elevenlabs", "stability"]) {
    assert.ok(apiProviderById(id), `registry should resolve ${id}`);
    assert.ok(PROVIDERS.some((provider) => provider.id === id), `PROVIDERS should include ${id}`);
    assert.strictEqual(PROVIDER_META[id].vendor, "생성형 미디어", `${id} needs vendor metadata`);
  }
  assert.strictEqual(apiProviderById("does-not-exist"), null);
  const higgs = catalog.find((entry) => entry.id === "higgsfield");
  assert.strictEqual(higgs.credentials.length, 2, "Higgsfield exposes two credential fields");
  assert.deepStrictEqual(apiProviderMeta().falai, { vendor: "생성형 미디어", vendorOrder: 80, serviceOrder: 10 });

  console.log("API-key provider (fal.ai / Higgsfield / Magnific / ElevenLabs / Stability) tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
