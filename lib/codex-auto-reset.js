const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { appData, readJson, writeJson } = require("./paths");
const { consumeAccountRateLimitResetCredit, SUCCESS_OUTCOMES } = require("./codex-reset-credit");

const STATE_VERSION = 1;
const ERROR_RETRY_MS = 5 * 60 * 1000;

function statePath() {
  return path.join(appData(), "how-much-is-tokens", "automation-state.json");
}

function readState(filePath = statePath()) {
  const data = readJson(filePath);
  if (!data || data.version !== STATE_VERSION || typeof data.codexAutoReset !== "object") {
    return { version: STATE_VERSION, codexAutoReset: {} };
  }
  return data;
}

function writeState(data, filePath = statePath()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, data);
}

function rateLimitSnapshots(response) {
  if (!response || typeof response !== "object") return [];
  const snapshots = [];
  if (response.rateLimits && typeof response.rateLimits === "object") {
    snapshots.push({ id: response.rateLimits.limitId || "default", value: response.rateLimits });
  }
  const byId = response.rateLimitsByLimitId;
  if (byId && typeof byId === "object") {
    for (const [id, value] of Object.entries(byId)) {
      if (value && typeof value === "object") snapshots.push({ id, value });
    }
  }
  return snapshots;
}

function isActualRateLimitReached(response) {
  return rateLimitSnapshots(response).some(({ value }) => value.rateLimitReachedType === "rate_limit_reached");
}

function resetFingerprint(response) {
  const reached = rateLimitSnapshots(response)
    .filter(({ value }) => value.rateLimitReachedType === "rate_limit_reached")
    .map(({ id, value }) => ({
      id: String(id),
      primaryReset: value.primary && value.primary.resetsAt != null ? Number(value.primary.resetsAt) : null,
      secondaryReset: value.secondary && value.secondary.resetsAt != null ? Number(value.secondary.resetsAt) : null,
      reachedType: value.rateLimitReachedType,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!reached.length) return null;
  // Percent values can fluctuate or be rounded while a limit remains reached.
  // The epoch is defined by the affected limit IDs and reset boundaries only,
  // so one ticket cannot be consumed again merely because a percentage moved.
  return crypto.createHash("sha256").update(JSON.stringify(reached)).digest("hex").slice(0, 24);
}

function selectCreditId(resetTickets) {
  if (!resetTickets || !Array.isArray(resetTickets.tickets)) return null;
  const tickets = resetTickets.tickets
    .filter((item) => item && item.status === "available" && item.id)
    .sort((a, b) => {
      const ae = Number(a.expiresAt);
      const be = Number(b.expiresAt);
      const av = Number.isFinite(ae) && ae > 0 ? ae : Infinity;
      const bv = Number.isFinite(be) && be > 0 ? be : Infinity;
      return av - bv;
    });
  return tickets.length ? String(tickets[0].id) : null;
}

function shouldRetryRecord(record, now) {
  if (!record || !record.outcome) return true;
  if (SUCCESS_OUTCOMES.has(record.outcome)) return false;
  if (["nothingToReset", "noCredit"].includes(record.outcome)) return false;
  return now - Number(record.attemptedAt || 0) >= ERROR_RETRY_MS;
}

async function maybeAutoConsumeReset(options = {}) {
  const settings = options.settings || {};
  const accountKey = String(options.accountKey || "codex:default");
  const rateLimitsRead = options.rateLimitsRead;
  const now = Number(options.now) || Date.now();
  const filePath = options.filePath || statePath();
  const consumeImpl = options.consumeImpl || consumeAccountRateLimitResetCredit;
  const consumeOptions = options.consumeOptions && typeof options.consumeOptions === "object"
    ? options.consumeOptions
    : {};

  if (settings.codexAutoUseReset !== true) return { attempted: false, reason: "disabled" };
  if (!rateLimitsRead || !rateLimitsRead.ok || !rateLimitsRead.response) {
    return { attempted: false, reason: "rate-limits-unavailable" };
  }
  if (!isActualRateLimitReached(rateLimitsRead.response)) {
    return { attempted: false, reason: "not-rate-limit-reached" };
  }

  const resetTickets = rateLimitsRead.resetTickets;
  if (!resetTickets || Number(resetTickets.availableCount) <= 0) {
    return { attempted: false, reason: "no-credit" };
  }

  const fingerprint = resetFingerprint(rateLimitsRead.response);
  if (!fingerprint) return { attempted: false, reason: "no-fingerprint" };

  const store = readState(filePath);
  const previous = store.codexAutoReset[accountKey];
  let idempotencyKey = randomUUID();
  let creditId = selectCreditId(resetTickets);

  if (previous && previous.fingerprint === fingerprint) {
    if (!shouldRetryRecord(previous, now)) {
      return { attempted: false, reason: "already-attempted", previous };
    }
    idempotencyKey = previous.idempotencyKey || idempotencyKey;
    if (previous.creditId) creditId = previous.creditId;
  }

  store.codexAutoReset[accountKey] = {
    fingerprint,
    idempotencyKey,
    creditId,
    attemptedAt: now,
    outcome: "pending",
  };
  writeState(store, filePath);

  let result;
  try {
    result = await consumeImpl({ ...consumeOptions, idempotencyKey, creditId });
  } catch (err) {
    result = { ok: false, reason: "consume-exception", error: err.message || String(err), idempotencyKey, creditId };
  }

  const outcome = result && result.outcome
    ? String(result.outcome)
    : result && result.reason
      ? String(result.reason)
      : "error";
  const latest = readState(filePath);
  latest.codexAutoReset[accountKey] = {
    fingerprint,
    idempotencyKey,
    creditId,
    attemptedAt: now,
    outcome,
  };
  writeState(latest, filePath);

  return {
    attempted: true,
    ok: !!(result && result.ok),
    outcome,
    idempotencyKey,
    creditId,
    result,
  };
}

module.exports = {
  STATE_VERSION,
  ERROR_RETRY_MS,
  statePath,
  readState,
  rateLimitSnapshots,
  isActualRateLimitReached,
  resetFingerprint,
  selectCreditId,
  maybeAutoConsumeReset,
};
