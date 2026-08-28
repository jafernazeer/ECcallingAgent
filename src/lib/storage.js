/**
 * Deliberate, versioned localStorage keys for the EC Calling Agent test portal.
 *
 * Only the *latest* test call is retained — this portal intentionally has no
 * historical lead database. Never store secrets or tokens here.
 */

const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  lead: "ethikcorp_ec_calling_agent_latest_lead",
  transcript: "ethikcorp_ec_calling_agent_latest_transcript",
  completedCall: "ethikcorp_ec_calling_agent_latest_completed_call",
  recipients: "ethikcorp_ec_calling_agent_notification_recipients",
};

function readRaw(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStored(key, fallback) {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    if (parsed.v !== SCHEMA_VERSION) return fallback;
    return parsed.data ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key, data) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, at: new Date().toISOString(), data }));
  } catch {
    // Storage can be unavailable (private mode, quota). Persistence is a
    // convenience here, never a requirement for the call to work.
  }
}

export function removeStored(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore — see writeStored.
  }
}
