import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import "./load-env.js";
import express from "express";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import {
  getPersistenceMode,
  listCallRecords,
  saveCallEvent,
  updateWorkflowStatus,
} from "./call-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);
const hmrPort = Number(process.env.HMR_PORT || port + 20000);
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const emailFrom = process.env.EMAIL_FROM || smtpUser;
const vapiApiHost = process.env.VAPI_API_HOST || "api.vapi.ai";
const vapiApiAddress = process.env.VAPI_API_ADDRESS || "104.18.24.64";
const vapiPublicKey = process.env.VITE_VAPI_PUBLIC_KEY || "f80cea3b-d773-4f2c-88a8-8d7c87cd57ee";
const vapiAssistantId = process.env.VITE_VAPI_ASSISTANT_ID || "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
const vapiAssistantName = process.env.VITE_VAPI_ASSISTANT_NAME || "EC Calling Agent";
const vapiClientApiBaseUrl = process.env.VITE_VAPI_API_BASE_URL || "/api/vapi";
// Retell — secret key is server-only and must never be exposed to the browser.
const retellApiKey = process.env.RETELL_API_KEY || "";
const retellAgentId = process.env.RETELL_AGENT_ID || "";
const retellApiBase = process.env.RETELL_API_BASE || "https://api.retellai.com";

/**
 * In-memory lead store keyed by the provider call id.
 *
 * The four capture tools each POST a slice of the lead; we merge them here so
 * the browser can read one complete record without any database round-trip.
 * Entries expire so a long-running process does not grow unbounded.
 */
const LEAD_TTL_MS = 1000 * 60 * 60 * 6;
const liveLeads = new Map();

function pruneLiveLeads() {
  const cutoff = Date.now() - LEAD_TTL_MS;
  for (const [key, entry] of liveLeads) {
    if (entry.updatedAtMs < cutoff) liveLeads.delete(key);
  }
}

function mergeLiveLead(callId, toolName, args) {
  if (!callId) return null;
  pruneLiveLeads();

  const existing = liveLeads.get(callId) || { callId, fields: {}, tools: [], updatedAtMs: 0 };
  const data = (args && typeof args === "object") ? args : {};

  const next = { ...existing.fields };
  const assign = (key, value) => {
    const cleaned = typeof value === "string" ? value.trim() : value;
    if (cleaned !== undefined && cleaned !== null && cleaned !== "") next[key] = cleaned;
  };

  assign("customer_name", data.customer_name || data.customerName);
  assign("company_name", data.company_name || data.companyName || data.company);
  assign("location", data.location || data.place);
  assign("location_confidence", data.location_confidence);
  assign("requirement_summary", data.requirement_summary || data.requirement);
  assign("industry", data.industry);
  assign("service_area", data.service_area || data.serviceArea);
  assign("phone_number", data.phone_number || data.contact_number || data.phone);
  assign("phone_confidence", data.phone_confidence);
  assign("email", data.email_id || data.email);
  assign("email_confidence", data.email_confidence);
  assign("call_outcome", data.call_outcome);
  if (typeof data.needs_human_review === "boolean") next.needs_human_review = data.needs_human_review;

  const entry = {
    callId,
    fields: next,
    tools: existing.tools.includes(toolName) ? existing.tools : [...existing.tools, toolName],
    updatedAtMs: Date.now(),
    updatedAt: new Date().toISOString(),
  };
  liveLeads.set(callId, entry);
  return entry;
}
const deliveredEmailIds = new Set();

const submitLeadToolSchema = {
  type: "function",
  function: {
    name: "submit_lead",
    description: "Submit any captured lead details to the EthikCorp Lead Management Portal. Call this once the caller has provided any contact or requirement information: Name, Company, Location, Requirements, Phone, or Email.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Caller name, if provided." },
        company_name: { type: "string", description: "Caller company or organization, if provided." },
        location: { type: "string", description: "Caller city, emirate, country, or place, if provided." },
        requirement_summary: { type: "string", description: "Brief summary of what the customer needs." },
        contact_number: { type: "string", description: "Caller phone number, if provided or available from the call." },
        email_id: { type: "string", description: "Caller email address, if provided." },
      },
      anyOf: [
        { required: ["customer_name"] },
        { required: ["company_name"] },
        { required: ["location"] },
        { required: ["requirement_summary"] },
        { required: ["contact_number"] },
        { required: ["email_id"] },
      ],
      additionalProperties: false,
    },
  },
};

const app = express();
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());

function proxyVapiApi(request, response) {
  const upstreamPath = request.originalUrl.replace(/^\/api\/vapi/, "") || "/";
  const payload = request.body && Object.keys(request.body).length ? JSON.stringify(request.body) : "";
  const headers = {
    ...request.headers,
    host: vapiApiHost,
  };
  delete headers.connection;
  delete headers["content-length"];

  const upstreamRequest = https.request({
    hostname: vapiApiAddress,
    servername: vapiApiHost,
    port: 443,
    path: upstreamPath,
    method: request.method,
    headers: {
      ...headers,
      ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
    },
  }, (upstreamResponse) => {
    response.status(upstreamResponse.statusCode || 502);
    Object.entries(upstreamResponse.headers).forEach(([key, value]) => {
      if (key.toLowerCase() !== "transfer-encoding" && value !== undefined) response.setHeader(key, value);
    });
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on("error", (error) => {
    response.status(502).json({ ok: false, error: error.message || "Vapi API proxy failed." });
  });

  if (payload) upstreamRequest.write(payload);
  upstreamRequest.end();
}

function sendApiError(response, error) {
  console.error(error);
  response.status(500).json({
    ok: false,
    error: error?.message || "Unexpected server error",
  });
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
  if (!value || depth > 4) return [];
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

const LEAD_TOOL_NAMES = new Set([
  "capture_identity",
  "capture_requirement",
  "capture_contact",
  "submit_lead",
]);

function findSubmitLeadArguments(payload) {
  const toolCall = collectToolCalls(payload).find((item) => LEAD_TOOL_NAMES.has(getToolName(item)));
  // Never fall back to the whole webhook body: its top-level `name` is the
  // tool name, which would land in the lead as the customer's name.
  return parseMaybeJson(getToolArguments(toolCall)) || parseMaybeJson(payload?.args) || {};
}

function findSubmitLeadToolCall(payload) {
  return collectToolCalls(payload).find((item) => LEAD_TOOL_NAMES.has(getToolName(item))) || null;
}

function getVapiCallId(payload) {
  return payload?.sessionId
    // Retell uses snake_case call_id; Vapi uses call.id / callId.
    || payload?.call_id
    || payload?.call?.call_id
    || payload?.message?.call?.call_id
    || payload?.callId
    || payload?.call?.id
    || payload?.call?.callId
    || payload?.message?.call?.id
    || payload?.message?.callId
    || payload?.message?.call?.monitor?.callId
    || payload?.message?.call?.callId
    || payload?.artifact?.call?.id
    || "";
}

function getBrowserSessionId(payload) {
  return payload?.browserSessionId
    || payload?.metadata?.browserSessionId
    || payload?.call?.metadata?.browserSessionId
    || payload?.message?.metadata?.browserSessionId
    || payload?.message?.call?.metadata?.browserSessionId
    || payload?.artifact?.call?.metadata?.browserSessionId
    || "";
}

function normalizeEmail(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

async function sendEmailSummary(recipients, subject, text) {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? {
      user: smtpUser,
      pass: smtpPass,
    } : undefined,
  });

  return transporter.sendMail({
    from: emailFrom,
    to: recipients,
    subject,
    text,
  });
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    persistence: getPersistenceMode(),
  });
});

app.get("/api/vapi/client-config", (_request, response) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.json({
    ok: true,
    publicKey: vapiPublicKey,
    assistantId: vapiAssistantId,
    assistantName: vapiAssistantName,
    apiBaseUrl: vapiClientApiBaseUrl,
  });
});

app.get("/api/vapi/lead-tool/schema", (_request, response) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.json(submitLeadToolSchema);
});

app.get("/api/call-records", async (_request, response) => {
  try {
    response.json({
      ok: true,
      ...(await listCallRecords()),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.post("/api/call-events", async (request, response) => {
  try {
    response.json({
      ok: true,
      ...(await saveCallEvent(request.body)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

// Provider-neutral path. /api/vapi/lead-tool is kept as an alias so existing
// agent configurations keep working.
app.post(["/api/lead-tool", "/api/vapi/lead-tool"], async (request, response) => {
  try {
    const toolCall = findSubmitLeadToolCall(request.body);
    const args = findSubmitLeadArguments(request.body);
    const vapiCallId = getVapiCallId(request.body);
    const browserSessionId = getBrowserSessionId(request.body);
    const sessionId = browserSessionId || request.body?.sessionId || (vapiCallId ? `vapi-${vapiCallId}` : `vapi-lead-${Date.now()}`);
    // Browser-readable copy, independent of the database.
    mergeLiveLead(vapiCallId || sessionId, getToolName(toolCall) || "submit_lead", args);

    const result = await saveCallEvent({
      type: "lead-captured",
      sessionId,
      externalCallId: vapiCallId || null,
      at: new Date().toISOString(),
      source: `Vapi ${getToolName(toolCall) || "submit_lead"} tool`,
      lead: args,
    }, request.body);

    response.json({
      ok: true,
      ...result,
      results: [{
        // Echo the real tool call id when the provider sends one. Retell puts it
        // at the payload root; Vapi nests it on the tool call itself.
        toolCallId: toolCall?.id
          || toolCall?.toolCallId
          || request.body?.tool_call_id
          || request.body?.toolCallId
          || getToolName(toolCall)
          || "submit_lead",
        result: "Lead submitted to the EthikCorp Lead Management Portal.",
      }],
      result: "Lead submitted to the EthikCorp Lead Management Portal.",
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.use("/api/vapi", proxyVapiApi);

/**
 * Mint a Retell web-call access token. The browser calls this instead of ever
 * holding the Retell secret key.
 */
app.post("/api/retell/web-call", async (request, response) => {
  try {
    if (!retellApiKey || !retellAgentId) {
      response.status(503).json({
        ok: false,
        error: "Retell is not configured on this server. Set RETELL_API_KEY and RETELL_AGENT_ID.",
      });
      return;
    }

    const upstream = await fetch(`${retellApiBase}/v2/create-web-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${retellApiKey}`,
      },
      body: JSON.stringify({
        agent_id: retellAgentId,
        metadata: {
          source: "Client agent test portal",
          browserSessionId: String(request.body?.browserSessionId || ""),
        },
      }),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      response.status(502).json({
        ok: false,
        error: result?.message || `Retell rejected the web call request (${upstream.status}).`,
      });
      return;
    }

    response.json({
      ok: true,
      accessToken: result.access_token,
      callId: result.call_id,
      agentId: retellAgentId,
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

/** Cached Retell call list — the dashboard reads through these, not the DB. */
const retellCache = { calls: null, at: 0 };
const RETELL_CACHE_MS = 30000;

async function retellFetch(path, options = {}) {
  if (!retellApiKey) throw new Error("Retell is not configured on this server.");
  const response = await fetch(`${retellApiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${retellApiKey}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Retell ${path} failed (${response.status}) ${detail.slice(0, 180)}`);
  }
  return response.json();
}

async function listRetellCalls({ force = false } = {}) {
  if (!force && retellCache.calls && Date.now() - retellCache.at < RETELL_CACHE_MS) {
    return retellCache.calls;
  }
  const result = await retellFetch("/v2/list-calls", {
    method: "POST",
    body: JSON.stringify({
      filter_criteria: retellAgentId ? { agent_id: [retellAgentId] } : undefined,
      limit: 100,
      sort_order: "descending",
    }),
  });
  const calls = Array.isArray(result) ? result : (result?.calls || []);
  retellCache.calls = calls;
  retellCache.at = Date.now();
  return calls;
}

/**
 * Resolve who the call was with, using the same sources as the lead record so
 * the Calls tab and the Leads tab never disagree about a caller's name.
 * Falls back to the call type only when no name was captured at all.
 */
function callerIdentityFromCall(call) {
  const analysis = call.call_analysis || {};
  const captured = liveLeads.get(call.call_id);
  const fields = mergeFields(
    captured?.fields,
    fieldsFromAnalysis(analysis.custom_analysis_data),
    fieldsFromSummary(analysis.call_summary || ""),
  );
  return {
    callerName: fields.customer_name || "",
    callerCompany: fields.company_name || "",
  };
}

function summariseCall(call) {
  const analysis = call.call_analysis || {};
  const start = Number(call.start_timestamp || 0);
  const end = Number(call.end_timestamp || 0);
  return {
    callId: call.call_id,
    startedAt: start ? new Date(start).toISOString() : "",
    durationSeconds: start && end ? Math.round((end - start) / 1000) : 0,
    direction: call.direction || call.call_type || "web_call",
    ...callerIdentityFromCall(call),
    disconnectionReason: call.disconnection_reason || "",
    successful: analysis.call_successful,
    sentiment: analysis.user_sentiment || "",
    summary: analysis.call_summary || "",
    cost: call.call_cost?.combined_cost ?? null,
  };
}

/**
 * Parse Retell's post-call summary line into lead fields.
 *
 * Retell writes summaries as "Name: X; Company: Y; ... Requirement: Z", with an
 * optional "(low confidence)" marker per field. Tool-call values remain the
 * source of truth — this only backfills calls that predate the capture tools.
 */
const EMPTY_VALUE = /^(none|n\/a|na|not provided|unknown|not captured|nil|no\b.*)$/i;
// "Unclear, needs follow-up" and friends are the model reporting a miss, not a
// requirement — match on the prefix so trailing commentary doesn't smuggle them in.
const NON_ANSWER_PREFIX = /^(unclear|not (provided|captured|specified|mentioned|discussed)|none|n\/a|unknown|to be (confirmed|determined)|tbd)\b/i;

/** Normalise one extracted value; returns "" when the model said "not provided". */
function cleanValue(raw, maxLength) {
  let value = String(raw ?? "").trim().replace(/\.$/, "").replace(/^\[|\]$/g, "").trim();
  if (!value || EMPTY_VALUE.test(value) || NON_ANSWER_PREFIX.test(value)) return "";
  if (value.length > maxLength) return "";
  return value;
}

/**
 * Pull labelled fields out of Retell's post-call summary line, which reads
 * "Inbound lead: Name: Dave. Company: Individual. Location: Dubai. ..."
 */
function fieldsFromSummary(summary) {
  const text = String(summary || "");
  if (!text.trim()) return {};

  const grab = (label, maxLength = 60) => {
    const match = new RegExp(`${label}\\s*:\\s*([^;\\n]+)`, "i").exec(text);
    if (!match) return { value: "", confidence: "" };
    let raw = match[1].trim();
    let confidence = "";
    const conf = /\((high|low)\s*confidence\)/i.exec(raw);
    if (conf) {
      confidence = conf[1].toLowerCase();
      raw = raw.replace(conf[0], "").trim();
    }
    // Summaries often omit the ";" separator and run into the next sentence,
    // e.g. "Dave. Company: Individual" — cut at the sentence boundary.
    raw = raw.split(/\.\s+(?=[A-Z])/)[0].trim();
    return { value: cleanValue(raw, maxLength), confidence };
  };

  const name = grab("Name");
  const company = grab("Company");
  const location = grab("Location");
  const phone = grab("Contact Number");
  const email = grab("Email");
  // Requirements are free text and routinely longer than the other fields.
  const requirement = grab("Requirement", 400);

  return {
    customer_name: name.value,
    company_name: company.value,
    location: location.value,
    location_confidence: location.confidence,
    phone_number: phone.value ? phone.value.replace(/[^\d+]/g, "") : "",
    phone_confidence: phone.confidence,
    email: email.value,
    email_confidence: email.confidence,
    requirement_summary: requirement.value,
  };
}

/**
 * Retell's custom post-call analysis returns the same fields already typed and
 * separated, so it beats parsing prose. Contact Number arrives as a JSON number,
 * which silently drops any leading zero — the summary string is preferred for
 * that one field whenever it carries more digits.
 */
function fieldsFromAnalysis(custom) {
  if (!custom || typeof custom !== "object") return {};
  const phone = custom["Contact Number"];
  return {
    customer_name: cleanValue(custom.Name, 60),
    company_name: cleanValue(custom.Company, 60),
    location: cleanValue(custom.Location, 60),
    phone_number: phone ? String(phone).replace(/[^\d+]/g, "") : "",
    email: cleanValue(custom.Email, 60),
  };
}

/**
 * Last resort for the requirement: read it out of the transcript itself. Takes
 * the caller's longest substantive turn, which in practice is where they state
 * what they actually need.
 */
function requirementFromTranscript(call) {
  const turns = Array.isArray(call?.transcript_object)
    ? call.transcript_object
    : String(call?.transcript || "")
        .split("\n")
        .map((line) => {
          const match = /^(Agent|User):\s*(.*)$/i.exec(line.trim());
          return match ? { role: match[1].toLowerCase(), content: match[2] } : null;
        })
        .filter(Boolean);

  const candidates = turns
    .filter((turn) => turn.role !== "agent")
    .map((turn) => String(turn.content || "").trim())
    // Skip acknowledgements and one-word answers — they are never requirements.
    .filter((text) => text.split(/\s+/).length >= 5 && !EMPTY_VALUE.test(text));

  if (!candidates.length) return "";
  const longest = candidates.sort((a, b) => b.length - a.length)[0];
  return longest.length > 400 ? `${longest.slice(0, 397)}…` : longest;
}

/** Keep the first non-empty value across sources, in priority order. */
function mergeFields(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (merged[key] === undefined || merged[key] === "" || merged[key] === null) {
        if (value !== undefined && value !== null && value !== "") merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Build one portal lead from a Retell call, combining every source we have:
 * the live capture tools, the structured post-call analysis, the AI call
 * summary, and finally the transcript itself.
 */
function leadFromCall(call, captured) {
  const analysis = call?.call_analysis || {};
  const summary = analysis.call_summary || "";

  const fromAnalysis = fieldsFromAnalysis(analysis.custom_analysis_data);
  const fromSummary = fieldsFromSummary(summary);

  // Precedence: the AI call summary first, then the structured post-call
  // analysis, and only then the capture tools. The tools fire mid-call and
  // report unreliable values (including on silent calls); the summary is
  // written afterwards from the whole conversation and tests as accurate.
  const fields = mergeFields(fromSummary, fromAnalysis, captured?.fields);

  // JSON numbers drop leading zeros, so "0588499663" reaches us as 588499663.
  // Whichever source kept more digits for the same number is the correct one.
  const phoneCandidates = [fromSummary.phone_number, fromAnalysis.phone_number, captured?.fields?.phone_number]
    .filter(Boolean);
  if (phoneCandidates.length > 1) {
    fields.phone_number = phoneCandidates.reduce((best, candidate) => (
      candidate.replace(/\D/g, "").endsWith(best.replace(/\D/g, "")) && candidate.length > best.length
        ? candidate
        : best
    ));
  }

  if (!fields.requirement_summary) {
    const fromTranscript = requirementFromTranscript(call);
    if (fromTranscript) {
      fields.requirement_summary = fromTranscript;
      fields.requirement_source = "transcript";
    }
  }

  const hasAnything = ["customer_name", "company_name", "location", "phone_number", "email", "requirement_summary"]
    .some((key) => fields[key]);
  if (!hasAnything) return null;

  return {
    ...fields,
    call_id: call.call_id,
    source: (fromSummary.customer_name || fromSummary.company_name) ? "call_summary" : (captured ? "tool_calls" : "call_analysis"),
    summary,
    startedAt: call.start_timestamp ? new Date(Number(call.start_timestamp)).toISOString() : "",
  };
}

/**
 * Leads for the CRM: confirmed tool-call captures first, with summary-derived
 * records filling in calls that have no tool data.
 */
app.get("/api/retell/leads", async (_request, response) => {
  try {
    const calls = await listRetellCalls();
    const leads = calls
      .map((call) => leadFromCall(call, liveLeads.get(call.call_id)))
      .filter(Boolean);

    response.json({ ok: true, leads });
  } catch (error) {
    response.json({ ok: false, leads: [], error: error.message });
  }
});

/** Call history for the Call Transcripts tab. */
app.get("/api/retell/calls", async (_request, response) => {
  try {
    const calls = await listRetellCalls();
    response.json({ ok: true, calls: calls.map(summariseCall) });
  } catch (error) {
    response.json({ ok: false, calls: [], error: error.message });
  }
});

/** Full transcript + analysis for one call. */
app.get("/api/retell/calls/:callId", async (request, response) => {
  try {
    const call = await retellFetch(`/v2/get-call/${encodeURIComponent(request.params.callId)}`);
    const turns = Array.isArray(call.transcript_object)
      ? call.transcript_object
          .filter((turn) => String(turn?.content || "").trim())
          .map((turn, index) => ({
            id: `${call.call_id}-${index}`,
            speaker: turn.role === "agent" ? "agent" : "user",
            text: String(turn.content).trim(),
          }))
      : [];
    response.json({ ok: true, call: { ...summariseCall(call), transcript: turns } });
  } catch (error) {
    response.json({ ok: false, call: null, error: error.message });
  }
});

/**
 * Aggregate metrics for the Overview tab.
 *
 * Retell exposes no aggregate analytics endpoint — the dashboard charts are
 * rendered from an internal, cookie-authenticated route. We derive the same
 * numbers from the call list instead.
 */
app.get("/api/retell/analytics", async (_request, response) => {
  try {
    const calls = await listRetellCalls();
    const answered = calls.filter((call) => Number(call.end_timestamp || 0) > 0);
    const withLead = calls.filter((call) => liveLeads.has(call.call_id));
    const successful = calls.filter((call) => call.call_analysis?.call_successful);

    const byDay = new Map();
    calls.forEach((call) => {
      const ts = Number(call.start_timestamp || 0);
      if (!ts) return;
      const day = new Date(ts).toISOString().slice(0, 10);
      const row = byDay.get(day) || { day, calls: 0, leads: 0 };
      row.calls += 1;
      if (liveLeads.has(call.call_id)) row.leads += 1;
      byDay.set(day, row);
    });

    const totalSeconds = calls.reduce((sum, call) => {
      const start = Number(call.start_timestamp || 0);
      const end = Number(call.end_timestamp || 0);
      return sum + (start && end ? (end - start) / 1000 : 0);
    }, 0);

    response.json({
      ok: true,
      totals: {
        calls: calls.length,
        answered: answered.length,
        leads: withLead.length,
        successful: successful.length,
        avgDurationSeconds: calls.length ? Math.round(totalSeconds / calls.length) : 0,
      },
      series: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
    });
  } catch (error) {
    response.json({ ok: false, totals: null, series: [], error: error.message });
  }
});

/** Read the merged, in-memory lead for a call. No database involved. */
app.get("/api/lead/:callId", (request, response) => {
  pruneLiveLeads();
  const entry = liveLeads.get(String(request.params.callId || ""));
  if (!entry) {
    response.json({ ok: true, found: false, lead: null, tools: [] });
    return;
  }
  response.json({ ok: true, found: true, lead: entry.fields, tools: entry.tools, updatedAt: entry.updatedAt });
});

app.post("/api/email-updates", async (request, response) => {
  try {
    const recipients = Array.isArray(request.body?.recipients) ? request.body.recipients : [];
    const subject = String(request.body?.subject || "EthikCorp Agent call summary").trim();
    const message = String(request.body?.message || "").trim();
    const deliveryId = String(request.body?.deliveryId || "").trim();
    const normalizedRecipients = [...new Set(recipients.map(normalizeEmail).filter(Boolean))];

    if (!normalizedRecipients.length) {
      response.status(400).json({ ok: false, error: "At least one valid email recipient is required." });
      return;
    }

    if (!message) {
      response.status(400).json({ ok: false, error: "Email message cannot be empty." });
      return;
    }

    if (deliveryId && deliveredEmailIds.has(deliveryId)) {
      response.json({
        ok: true,
        configured: Boolean(smtpHost && emailFrom),
        sent: 0,
        duplicate: true,
        recipients: normalizedRecipients,
      });
      return;
    }

    if (!smtpHost || !emailFrom) {
      response.json({
        ok: true,
        configured: false,
        sent: 0,
        recipients: normalizedRecipients,
      });
      return;
    }

    const result = await sendEmailSummary(normalizedRecipients, subject, message);
    if (deliveryId) {
      if (deliveredEmailIds.size > 1000) deliveredEmailIds.clear();
      deliveredEmailIds.add(deliveryId);
    }
    response.json({
      ok: true,
      configured: true,
      sent: normalizedRecipients.length,
      recipients: normalizedRecipients,
      messageId: result.messageId || "",
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

app.patch("/api/calls/:id/status", async (request, response) => {
  try {
    response.json({
      ok: true,
      ...(await updateWorkflowStatus(request.params.id, request.body?.workflowStatus)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
});

if (isProduction) {
  const distPath = path.join(root, "dist");
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, host: "0.0.0.0", hmr: { port: hmrPort } },
    appType: "spa",
  });

  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`EthikCorp Agent test portal running at http://localhost:${port}/`);
});
