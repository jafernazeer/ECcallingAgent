/**
 * Pure helpers for the EC Calling Agent voice session.
 *
 * These helpers keep the Vapi event contract and the /api/call-events payload
 * shape stable for the standalone EthikCorp agent test portal.
 */

export const CALL_SOURCE = "Client agent test portal";

export const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY || "f80cea3b-d773-4f2c-88a8-8d7c87cd57ee";
export const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID || "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
export const VAPI_API_BASE_URL = import.meta.env.VITE_VAPI_API_BASE_URL
  || (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api/vapi" : undefined);
export const VAPI_ASSISTANT_NAME = "EC Calling Agent";

export const DASHBOARD_EVENTS_URL = import.meta.env.VITE_DASHBOARD_EVENTS_URL || "";
const DASHBOARD_RECORDS_URL = DASHBOARD_EVENTS_URL.replace(/\/call-events(?:\?.*)?$/, "/call-records");

export async function getVapiClientConfig() {
  try {
    const response = await fetch(`/api/vapi/client-config?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Vapi config unavailable.");
    const config = await response.json();
    return {
      publicKey: config.publicKey || VAPI_PUBLIC_KEY,
      assistantId: config.assistantId || VAPI_ASSISTANT_ID,
      apiBaseUrl: config.apiBaseUrl || VAPI_API_BASE_URL,
    };
  } catch {
    return {
      publicKey: VAPI_PUBLIC_KEY,
      assistantId: VAPI_ASSISTANT_ID,
      apiBaseUrl: VAPI_API_BASE_URL,
    };
  }
}

export function nowIso() {
  return new Date().toISOString();
}

const CUSTOMER_GOODBYE_PATTERN = /\b(bye|goodbye|that'?s all|that is all|no thanks|no thank you|thanks bye|thank you bye|ok bye|okay bye|see you)\b/i;
// Sign-off phrases ONLY. Deliberately excludes greeting-style courtesies such
// as "thank you for contacting …", which the agent opens the call with — that
// false positive used to hang the call up ~5s after it connected.
const AGENT_GOODBYE_PATTERN = /\b(goodbye|bye for now|have a great day|have a good day|take care|thank you for your time|thanks for your time|someone will (get back|reach out)|we'?ll be in touch)\b/i;

export function isFinalTranscript(event) {
  return Boolean(event?.text) && event.final !== false && !event.partial;
}

export function isCustomerGoodbye(text) {
  return CUSTOMER_GOODBYE_PATTERN.test(String(text || ""));
}

export function isAgentGoodbye(text) {
  return AGENT_GOODBYE_PATTERN.test(String(text || ""));
}

async function postCallEvent(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: JSON.stringify(payload).length < 60000,
  });
  if (!response.ok) throw new Error(`Call event sync failed with ${response.status}`);
  return response.json().catch(() => ({}));
}

export async function persistCallEvent(event) {
  if (!event?.sessionId) return [];
  const payload = { source: CALL_SOURCE, ...event };
  const requests = [postCallEvent("/api/call-events", payload)];
  if (DASHBOARD_EVENTS_URL) {
    requests.push(postCallEvent(DASHBOARD_EVENTS_URL, payload));
  }
  const results = await Promise.allSettled(requests);
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].reason;
  }
  return results;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/**
 * Read the completed call back from the shared source. This closes the small
 * gap where Vapi's server-side submit_lead tool finishes after the last browser
 * message, so the portal can still show the authoritative structured lead.
 */
export async function fetchCompletedCallRecord(sessionId) {
  return fetchCompletedCallRecordByIds({ sessionId });
}

export async function fetchCompletedCallRecordByIds({ sessionId, externalCallId }) {
  const urls = [...new Set(["/api/call-records", DASHBOARD_RECORDS_URL].filter(Boolean))];
  let bestMatch = null;
  const externalIds = [externalCallId, externalCallId ? `vapi-${externalCallId}` : ""].filter(Boolean);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const results = await Promise.allSettled(urls.map(async (url) => {
      const response = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload.records?.find((record) => (
        record.id === sessionId
        || externalIds.includes(record.id)
        || (externalCallId && record.externalCallId === externalCallId)
      )) || null;
    }));

    bestMatch = results.find((result) => result.status === "fulfilled" && result.value)?.value || bestMatch;
    if (bestMatch?.status === "ended" && (bestMatch.lead || bestMatch.transcript?.length)) return bestMatch;
    await wait(260 + (attempt * 220));
  }

  return bestMatch;
}

export function extractVapiCallId(value) {
  if (!value || typeof value !== "object") return "";
  return String(
    value.callId
      || value.id
      || value.call?.id
      || value.message?.call?.id
      || value.message?.callId
      || value.message?.call?.monitor?.callId
      || value.artifact?.call?.id
      || "",
  ).trim();
}

export async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported by this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

function toErrorText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Turn provider/browser errors into language a prospective client can read.
 * Raw SDK text is never surfaced to the UI.
 */
export function getFriendlyCallError(error) {
  const raw = `${toErrorText(error?.error)} ${toErrorText(error)}`.toLowerCase();

  if (raw.includes("notallowed") || raw.includes("permission denied") || raw.includes("permission dismissed")) {
    return {
      kind: "permission",
      message: "We couldn't access your microphone. Enable microphone permission in your browser and try again.",
    };
  }
  if (raw.includes("notfound") || raw.includes("device not found") || raw.includes("requested device not found")) {
    return {
      kind: "device",
      message: "No microphone was found. Connect a microphone and start the call again.",
    };
  }
  if (raw.includes("notreadable") || raw.includes("could not start audio source")) {
    return {
      kind: "device",
      message: "Your microphone is being used by another app. Close it and start the call again.",
    };
  }
  if (raw.includes("not supported") || raw.includes("media devices")) {
    return {
      kind: "device",
      message: "Microphone calling is not supported in this browser. Open the portal in Safari or Chrome and try again.",
    };
  }
  if (raw.includes("network") || raw.includes("failed to fetch") || raw.includes("timeout")) {
    return {
      kind: "network",
      message: "The connection dropped before the call could start. Check your network and try again.",
    };
  }
  return {
    kind: "unknown",
    message: "The call could not be started. Check your microphone permission and try again.",
  };
}

export function extractTranscriptFromVapiMessage(message) {
  if (message?.type !== "transcript" || !message.transcript?.trim()) return null;
  const role = String(message.role || "").toLowerCase();
  return {
    type: "transcript",
    speaker: role === "assistant" || role === "bot" ? "AI Agent" : "Customer",
    text: message.transcript.trim(),
    final: message.transcriptType !== "partial",
    partial: message.transcriptType === "partial",
    at: nowIso(),
  };
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function compactCompanyToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isEmailDerivedCompany(company, email) {
  const companyToken = compactCompanyToken(company);
  const domain = String(email || "").split("@")[1] || "";
  if (!companyToken || !domain) return false;
  const domainToken = compactCompanyToken(domain);
  const domainStemToken = compactCompanyToken(domain.split(".")[0]);
  return companyToken === domainToken || companyToken === domainStemToken;
}

function cleanCapturedCompany(company, email) {
  const cleaned = String(company || "").trim();
  return isEmailDerivedCompany(cleaned, email) ? "" : cleaned;
}

const LEAD_TOOL_NAMES = new Set([
  "capture_identity",
  "capture_requirement",
  "capture_contact",
  "submit_lead",
]);

/**
 * Map any of the v2 capture tools (or a legacy single-shot submit_lead payload)
 * onto the portal's internal lead shape. Only keys the tool actually supplied
 * are returned, so partial results merge cleanly instead of blanking fields.
 */
function normalizeLeadToolArgs(args) {
  const data = parseMaybeJson(args);
  if (!data || typeof data !== "object") return null;

  const email = String(data.email_id || data.emailId || data.email || "").trim();
  const name = String(data.customer_name || data.customerName || "").trim();
  const company = cleanCapturedCompany(data.company_name || data.companyName || data.company, email);
  const place = String(data.location || data.place || "").trim();
  const requirement = String(data.requirement_summary || data.requirementSummary || data.requirement || "").trim();
  const phone = String(
    data.phone_number || data.phoneNumber
    || data.contact_number || data.contactNumber
    || data.phone || "",
  ).trim();
  const industry = String(data.industry || "").trim();
  const serviceArea = String(data.service_area || data.serviceArea || data.service_interest || "").trim();

  const lead = {};
  if (name) lead.name = name;
  if (company) lead.company = company;
  if (place) lead.place = place;
  if (requirement) lead.requirement = requirement;
  if (phone) lead.phone = phone;
  if (email) lead.email = email;
  if (industry) lead.industry = industry;
  if (serviceArea) lead.serviceArea = serviceArea;

  // v2 confidence + routing flags
  if (data.location_confidence) lead.locationConfidence = String(data.location_confidence).toLowerCase();
  if (data.phone_confidence) lead.phoneConfidence = String(data.phone_confidence).toLowerCase();
  if (data.email_confidence) lead.emailConfidence = String(data.email_confidence).toLowerCase();
  if (typeof data.needs_human_review === "boolean") lead.needsHumanReview = data.needs_human_review;
  if (data.call_outcome) lead.callOutcome = String(data.call_outcome).trim();

  return Object.keys(lead).length ? lead : null;
}

function getToolName(toolCall) {
  return toolCall?.function?.name
    || toolCall?.functionCall?.name
    || toolCall?.function_call?.name
    || toolCall?.tool?.function?.name
    || toolCall?.name
    || "";
}

function getToolArguments(toolCall) {
  return toolCall?.function?.arguments
    || toolCall?.functionCall?.parameters
    || toolCall?.function_call?.arguments
    || toolCall?.parameters
    || toolCall?.arguments
    || toolCall?.args
    || toolCall?.input
    || null;
}

function collectToolCalls(value, depth = 0) {
  if (!value || depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectToolCalls(item, depth + 1));
  if (typeof value !== "object") return [];

  const directCalls = [
    value.toolCall,
    value.functionCall,
    value.function_call,
    ...(Array.isArray(value.toolCalls) ? value.toolCalls : []),
    ...(Array.isArray(value.tool_calls) ? value.tool_calls : []),
    ...(Array.isArray(value.toolCallList) ? value.toolCallList : []),
  ].filter(Boolean);

  return [
    value,
    ...directCalls,
    ...collectToolCalls(value.message, depth + 1),
    ...collectToolCalls(value.artifact, depth + 1),
  ];
}

export function extractSubmitLeadEvents(message) {
  const seen = new Set();
  return collectToolCalls(message)
    .map((toolCall) => {
      const name = getToolName(toolCall);
      if (!LEAD_TOOL_NAMES.has(name)) return null;
      const lead = normalizeLeadToolArgs(getToolArguments(toolCall));
      if (!lead) return null;
      const key = `${name}:${JSON.stringify(lead)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        type: "lead-captured",
        lead,
        toolName: name,
        toolCallId: toolCall.id || toolCall.toolCallId || "",
        at: nowIso(),
      };
    })
    .filter(Boolean);
}

function normalizeTranscriptForLead(entries = []) {
  return entries
    .filter((entry) => entry?.text?.trim() && !entry.partial)
    .map((entry) => {
      const speaker = entry.speaker === "agent" || entry.speaker === "AI Agent" ? "agent" : "user";
      return {
        speaker,
        text: String(entry.text || "").replace(/\s+/g, " ").trim(),
      };
    });
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

function titleCaseName(value) {
  const cleaned = String(value || "")
    .replace(/\b(?:from|at|with|for|in|and|my email|email|phone|number|calling|looking|need|require|company)\b.*$/i, "")
    .replace(/[^a-zA-Z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  if (!words.length) return "";
  if (words.some((word) => /^(from|email|phone|need|calling|company|location)$/i.test(word))) return "";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function cleanEntity(value) {
  return String(value || "")
    .replace(/\b(?:and|my email|email|phone|number|contact|requirement|i need|we need|looking for|located|based)\b.*$/i, "")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRequirementText(value) {
  return String(value || "")
    .replace(/\b(?:my name is|this is|i am|i'm|name is|call me)\b[^,.]*[,.]?/i, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "")
    .replace(/\b(?:from|at|with)\s+[A-Z][A-Za-z0-9 &.'-]{2,80}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.-]+|[,.-]+$/g, "");
}

function customerAfterPrompt(entries, promptPattern) {
  const promptIndex = entries.findIndex((entry) => entry.speaker === "agent" && promptPattern.test(entry.text));
  if (promptIndex < 0) return "";
  return entries.slice(promptIndex + 1).find((entry) => entry.speaker === "user" && entry.text)?.text || "";
}

function extractLocation(text) {
  const knownPlace = text.match(/\b(Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|UAE|United Arab Emirates|Kuwait|Saudi Arabia|Qatar|Oman|Bahrain|India|London|Singapore)\b/i)?.[1];
  if (knownPlace) return knownPlace;
  return cleanEntity(firstMatch(text, [
    /\b(?:based in|located in|location is|from|in)\s+([A-Z][A-Za-z .'-]{2,40})\b/i,
  ]));
}

export function deriveLeadFromTranscript(entries = []) {
  const normalized = normalizeTranscriptForLead(entries);
  const customerText = normalized
    .filter((entry) => entry.speaker === "user")
    .map((entry) => entry.text)
    .join(" ");
  if (!customerText.trim()) return null;

  const namePromptAnswer = customerAfterPrompt(normalized, /\b(name|who am i speaking with|may i know|can i have your name|full name)\b/i);
  const companyPromptAnswer = customerAfterPrompt(normalized, /\b(company|organisation|organization|business name)\b/i);
  const locationPromptAnswer = customerAfterPrompt(normalized, /\b(location|where are you based|which emirate|which country|based in)\b/i);
  const requirementPromptAnswer = customerAfterPrompt(normalized, /\b(how can i help|what.*requirement|what.*need|looking for|interested in|service|support)\b/i);

  const email = customerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = customerText.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ").trim() || "";
  const name = titleCaseName(firstMatch(customerText, [
    /\b(?:my name is|this is|i am|i'm|it's|its|name is|call me)\s+([a-zA-Z .'-]{2,80})/i,
  ]) || namePromptAnswer);
  const company = cleanCapturedCompany(cleanEntity(firstMatch(customerText, [
    /\b(?:company is|company name is|organisation is|organization is|business is)\s+([A-Z][A-Za-z0-9 &.'-]{2,90})/i,
    /\b(?:from|with|at|work at|working at)\s+([A-Z][A-Za-z0-9 &.'-]{2,90}(?:LLC|L\.L\.C|Ltd|Limited|Group|Consulting|Solutions|Company|Co\.|FZE|FZCO|Clinic|Hospital|Realty|Properties)?)\b/i,
  ]) || companyPromptAnswer), email);
  const place = extractLocation([locationPromptAnswer, customerText].filter(Boolean).join(" "));

  const explicitRequirement = cleanRequirementText(firstMatch(customerText, [
    /\b(?:i need|we need|looking for|interested in|want|require|requirement is|calling about|need help with|enquire about|inquire about)\s+(.{8,220})/i,
  ]));
  const fallbackRequirement = cleanRequirementText(requirementPromptAnswer)
    || normalized
      .filter((entry) => entry.speaker === "user")
      .map((entry) => cleanRequirementText(entry.text))
      .find((text) => text.length > 18 && !/@/.test(text) && !/(?:\+?\d[\d\s().-]{7,}\d)/.test(text))
    || "";
  const requirement = explicitRequirement || fallbackRequirement;

  const lead = {
    name,
    company,
    place,
    phone,
    email,
    requirement,
  };

  return Object.values(lead).some(Boolean) ? lead : null;
}

export function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Build the plain-text body emailed to the configured recipients. */
export function buildEmailSummary({ lead, transcript, startedAt, durationSeconds }) {
  const lines = [];
  lines.push("CALL SUMMARY");
  lines.push(`Source: ${CALL_SOURCE}`);
  if (startedAt) lines.push(`Started: ${new Date(startedAt).toLocaleString("en-GB")}`);
  lines.push(`Duration: ${formatDuration(durationSeconds || 0)}`);
  lines.push("");

  lines.push("LEAD DETAILS");
  if (lead) {
    lines.push(`Name: ${lead.name || "—"}`);
    lines.push(`Company: ${lead.company || "—"}`);
    lines.push(`Location: ${lead.place || "—"}`);
    lines.push(`Phone: ${lead.phone || "—"}`);
    lines.push(`Email: ${lead.email || "—"}`);
    lines.push(`Requirement: ${lead.requirement || "—"}`);
  } else {
    lines.push("No structured lead was captured during this call.");
  }
  lines.push("");

  lines.push("CALL TRANSCRIPT");
  if (transcript?.length) {
    transcript.forEach((entry) => {
      const who = entry.speaker === "agent" ? "EC Calling Agent" : "Caller";
      lines.push(`${who}: ${entry.text}`);
    });
  } else {
    lines.push("No transcript was captured for this call.");
  }

  return lines.join("\n");
}

/**
 * The dashboard is English-only. Retell's transcriber picks up background
 * conversation in other languages - Hindi, Malayalam, Tamil and so on - and
 * writes those turns into the transcript, which is noise the reader cannot
 * act on. Drop a turn when it is mostly non-Latin script, and strip stray
 * non-Latin characters from turns that are otherwise English.
 */
const NON_LATIN_LETTERS = /[\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g;
const LATIN_LETTERS = /[A-Za-z]/g;

export function toEnglishOnly(text) {
  const raw = String(text || "");
  const nonLatin = (raw.match(NON_LATIN_LETTERS) || []).length;
  if (!nonLatin) return raw;
  const latin = (raw.match(LATIN_LETTERS) || []).length;
  // Predominantly another language - the whole turn is background noise.
  if (nonLatin / (nonLatin + latin) > 0.2) return "";
  return raw.replace(NON_LATIN_LETTERS, "").replace(/\s{2,}/g, " ").trim();
}
