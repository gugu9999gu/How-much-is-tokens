const claude = require("./providers/claude");
const codex = require("./providers/codex");
const cursor = require("./providers/cursor");
const copilot = require("./providers/copilot");
const grok = require("./providers/grok");
const gemini = require("./providers/gemini");
const antigravity = require("./providers/antigravity");

const PROVIDERS = [claude, cursor, codex, copilot, grok, gemini, antigravity];

async function safeFetch(provider, settings) {
  try {
    return await provider.fetchUsage(settings || {});
  } catch (err) {
    return {
      id: provider.id,
      name: provider.id,
      status: "error",
      error: err.message || String(err),
    };
  }
}

async function fetchAll(settings = {}) {
  const providers = await Promise.all(PROVIDERS.map((provider) => safeFetch(provider, settings)));
  return {
    fetchedAt: Date.now(),
    providers,
  };
}

module.exports = { fetchAll, PROVIDERS };
