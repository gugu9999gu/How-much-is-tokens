const assert = require("assert");
const secure = require("../lib/secure-secrets");

// Provider id / field normalization and secret-name derivation.
assert.strictEqual(secure.cleanApiProviderId("FALAI"), "falai");
assert.strictEqual(secure.cleanApiProviderId("higgs-field"), "higgs-field");
assert.strictEqual(secure.cleanApiProviderId("bad id"), null);
assert.strictEqual(secure.cleanApiProviderId("under_score"), null, "underscore is not allowed in provider ids");
assert.strictEqual(secure.cleanApiProviderId(""), null);

assert.strictEqual(secure.apiProviderSecretName("falai", "apiKey"), "apiProvider:falai:apiKey");
assert.strictEqual(secure.apiProviderSecretName("higgsfield", "keySecret"), "apiProvider:higgsfield:keySecret");
assert.throws(() => secure.apiProviderSecretName("bad id", "apiKey"), /Invalid API provider id/);
assert.throws(() => secure.apiProviderSecretName("falai", "bad field"), /Invalid API provider secret field/);
assert.throws(() => secure.apiProviderSecretName("falai", "1leading"), /Invalid API provider secret field/);

// The secret-name whitelist must accept generic API-provider names while still
// rejecting arbitrary or malformed selectors.
secure.assertAllowed("apiProvider:falai:apiKey");
secure.assertAllowed("apiProvider:higgsfield:keySecret");
assert.throws(() => secure.assertAllowed("apiProvider:falai:bad-field"), /Unsupported secret/, "hyphen is not a valid field");
assert.throws(() => secure.assertAllowed("apiProvider:Bad:apiKey"), /Unsupported secret/, "uppercase provider id rejected");
assert.throws(() => secure.assertAllowed("random:secret:value"), /Unsupported secret/);

// Existing OpenRouter secret selectors must keep working unchanged.
secure.assertAllowed("openrouterApiKey");
secure.assertAllowed("openrouterProfile:default:apiKey");

console.log("API-provider secret-name boundary tests passed");
