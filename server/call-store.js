import { createClient } from "@supabase/supabase-js";

const MAX_CALL_RECORDS = 80;
const WORKFLOW_STATUSES = ["Open", "Follow up required", "Closed"];

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

export function getPersistenceMode() {
  return supabase ? "supabase" : "local";
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getWorkflowStatus(status) {
  return WORKFLOW_STATUSES.includes(status) ? status : "Open";
}

function normalizeTranscriptEntry(entry) {
  return {
    speaker: entry?.speaker || "Customer",
    text: String(entry?.text || "").trim(),
    at: normalizeDate(entry?.at || entry?.spoken_at) || nowIso(),
    final: entry?.final !== false && entry?.is_final !== false,
    partial: Boolean(entry?.partial),
  };
}

function customerEntries(entries) {
  return entries.filter((entry) => entry.speaker === "Customer" && entry.text.trim());
}

function answerAfterAgentPrompt(entries, promptPattern) {
  const promptIndex = entries.findIndex((entry) => entry.speaker === "AI Agent" && promptPattern.test(entry.text));
  return promptIndex >= 0
    ? entries.slice(promptIndex + 1).find((entry) => entry.speaker === "Customer" && entry.text.trim())
    : null;
}

function cleanStatedName(value) {
  if (!value) return "";
  const cleaned = value
    .replace(/\b(?:from|in|at|with|for|and|my email|email|phone|number|calling|i need|we need|looking for|regarding|about)\b.*$/i, "")
    .replace(/[^a-zA-Z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  if (!words.length || words.some((word) => /^(from|email|phone|need|calling)$/i.test(word))) return "";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function cleanRequirement(value) {
  if (!value) return "";
  return value
    .replace(/\b(?:my name is|this is|i am|i'm|name is|call me)\b[^,.]*[,.]?/i, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.-]+|[,.-]+$/g, "");
}

function extractRequirement(entries, call) {
  const promptedAnswer = answerAfterAgentPrompt(entries, /\b(how can i help|what.*requirement|what.*need|looking for|interested in|service|support|clarification)\b/i);
  const candidates = [promptedAnswer, ...customerEntries(entries)].filter(Boolean);

  for (const entry of candidates) {
    const explicitMatch = entry.text.match(/\b(?:i need|we need|looking for|interested in|want|require|calling about|need help with|enquire about|inquire about)\s+(.{8,220})/i);
    const explicitRequirement = cleanRequirement(explicitMatch?.[1]);
    if (explicitRequirement.length > 8) return explicitRequirement;

    const requirement = cleanRequirement(entry.text);
    if (requirement.length > 18 && !/@/.test(entry.text)) return requirement;
  }

  return call?.summary || call?.lead?.requirement || "Live EC Calling Agent inquiry";
}

function extractPlace(entries, body, call) {
  const afterPrompt = answerAfterAgentPrompt(entries, /\b(location|where are you based|which emirate|which country|based in)\b/i);
  const locationText = [afterPrompt?.text, body].filter(Boolean).join(" ");
  const explicitMatch = locationText.match(/\b(?:based in|from|in|located in)\s+(Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|UAE|Kuwait|Saudi Arabia|Qatar|Oman|Bahrain)\b/i);
  const placeMatch = locationText.match(/\b(Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|UAE|United Arab Emirates|Kuwait|Saudi Arabia|Qatar|Oman|Bahrain)\b/i);
  return call?.lead?.place || explicitMatch?.[1] || placeMatch?.[1] || "Not captured";
}

function deriveLeadDetails(call, transcriptRows = []) {
  const entries = transcriptRows.map(normalizeTranscriptEntry);
  const body = entries.map((entry) => entry.text).join(" ");
  const email = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || call?.lead?.email || "Not provided";
  const phone = body.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ") || call?.caller_number || call?.lead?.phone || "Browser call";

  const afterPrompt = answerAfterAgentPrompt(entries, /\b(name|who am i speaking with|may i know|can i have your name|full name)\b/i);
  const candidateLines = [afterPrompt, ...customerEntries(entries)].filter(Boolean);
  let name = call?.lead?.name || "";

  for (const entry of candidateLines) {
    const explicitMatch = entry.text.match(/\b(?:my name is|this is|i am|i'm|it's|its|name is|call me)\s+([a-zA-Z .'-]{2,80})/i);
    const explicitName = cleanStatedName(explicitMatch?.[1]);
    if (explicitName) {
      name = explicitName;
      break;
    }

    if (afterPrompt && entry === afterPrompt) {
      const directName = cleanStatedName(entry.text);
      if (directName) {
        name = directName;
        break;
      }
    }
  }

  return {
    name: name || "Caller",
    phone,
    email,
    place: extractPlace(entries, body, call),
    requirement: extractRequirement(entries, call),
  };
}

function mapCallRow(row) {
  const transcript = [...(row.transcripts || [])]
    .sort((a, b) => new Date(a.spoken_at).getTime() - new Date(b.spoken_at).getTime())
    .map((entry) => ({
      speaker: entry.speaker || "Customer",
      text: entry.text || "",
      at: entry.spoken_at || entry.created_at,
      final: entry.is_final !== false,
      partial: Boolean(entry.partial),
    }));

  return {
    id: row.id,
    vapiCallId: row.vapi_call_id,
    startedAt: row.started_at || row.created_at,
    endedAt: row.ended_at,
    status: row.status || "connecting",
    channel: row.channel || "Voice",
    source: row.source || "Phone widget",
    agentJoined: Boolean(row.agent_joined),
    workflowStatus: getWorkflowStatus(row.workflow_status),
    transcript,
    summary: row.summary || "Live EC Calling Agent call in progress.",
    lead: row.lead || row.leads?.[0] || null,
  };
}

function requireSupabase() {
  if (!supabase) {
    return null;
  }
  return supabase;
}

export async function listCallRecords() {
  const client = requireSupabase();
  if (!client) return { persistence: "local", records: [] };

  const { data, error } = await client
    .from("calls")
    .select("*, transcripts(*), leads(*)")
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CALL_RECORDS);

  if (error) throw error;
  return {
    persistence: "supabase",
    records: (data || []).map(mapCallRow),
  };
}

async function upsertCallLead(callId) {
  const client = requireSupabase();
  if (!client) return;

  const { data: call, error: callError } = await client
    .from("calls")
    .select("*")
    .eq("id", callId)
    .single();
  if (callError || !call) return;

  const { data: transcriptRows } = await client
    .from("transcripts")
    .select("*")
    .eq("call_id", callId)
    .order("spoken_at", { ascending: true });

  const lead = deriveLeadDetails(call, transcriptRows || []);
  await client
    .from("leads")
    .upsert({
      id: `lead-${callId}`,
      call_id: callId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      place: lead.place,
      requirement: lead.requirement,
      status: getWorkflowStatus(call.workflow_status),
      source: call.source || "ai_call",
      last_contact_at: call.ended_at || call.started_at || nowIso(),
      updated_at: nowIso(),
    }, { onConflict: "id" });

  await client
    .from("calls")
    .update({ lead, updated_at: nowIso() })
    .eq("id", callId);
}

export async function updateWorkflowStatus(callId, workflowStatus) {
  const client = requireSupabase();
  if (!client) return { persistence: "local", updated: false };

  const status = getWorkflowStatus(workflowStatus);
  const { error } = await client
    .from("calls")
    .update({ workflow_status: status, updated_at: nowIso() })
    .eq("id", callId);
  if (error) throw error;

  await client
    .from("leads")
    .update({ status, updated_at: nowIso() })
    .eq("call_id", callId);

  return { persistence: "supabase", updated: true };
}

export async function saveCallEvent(event, rawPayload = null) {
  const client = requireSupabase();
  if (!client) return { persistence: "local", saved: false };
  if (!event?.sessionId) return { persistence: "supabase", saved: false };

  const callId = event.sessionId;
  const currentTime = nowIso();
  const callPatch = {
    id: callId,
    vapi_call_id: event.vapiCallId || event.callId || null,
    channel: event.channel || "Voice",
    source: event.source || "Phone widget",
    updated_at: currentTime,
    raw: rawPayload || event,
  };

  if (event.type === "call-created") {
    Object.assign(callPatch, {
      started_at: normalizeDate(event.startedAt) || currentTime,
      ended_at: null,
      status: "connecting",
      workflow_status: "Open",
      summary: "Live EC Calling Agent call in progress.",
      agent_joined: false,
    });
  }

  if (event.type === "call-start") {
    Object.assign(callPatch, {
      started_at: normalizeDate(event.startedAt) || currentTime,
      status: "connected",
      agent_joined: true,
    });
  }

  if (event.type === "call-end") {
    Object.assign(callPatch, {
      ended_at: normalizeDate(event.endedAt) || currentTime,
      status: "ended",
      summary: event.summary || event.message || "EC Calling Agent call ended.",
      agent_joined: false,
    });
  }

  if (event.type === "call-error") {
    Object.assign(callPatch, {
      ended_at: normalizeDate(event.endedAt) || currentTime,
      status: "error",
      summary: event.message || "EC Calling Agent call failed.",
      agent_joined: false,
    });
  }

  await client
    .from("calls")
    .upsert(callPatch, { onConflict: "id" });

  if (event.type === "transcript" && event.text?.trim()) {
    await client
      .from("transcripts")
      .insert({
        call_id: callId,
        speaker: event.speaker || "Customer",
        text: String(event.text).trim(),
        is_final: event.final !== false,
        partial: Boolean(event.partial),
        spoken_at: normalizeDate(event.at) || currentTime,
      });

    await upsertCallLead(callId);
  }

  if (event.type === "call-end" || event.type === "call-error") {
    await upsertCallLead(callId);
  }

  return { persistence: "supabase", saved: true };
}

function pickVapiMessage(payload) {
  return payload?.message || payload || {};
}

function getVapiCallId(payload) {
  const message = pickVapiMessage(payload);
  return message?.call?.id
    || message?.callId
    || payload?.call?.id
    || payload?.callId
    || payload?.id
    || null;
}

export async function saveVapiWebhook(payload) {
  const message = pickVapiMessage(payload);
  const type = String(message?.type || payload?.type || "").toLowerCase();
  const callId = getVapiCallId(payload);
  if (!callId) return { persistence: getPersistenceMode(), saved: false, reason: "missing_call_id" };

  const base = {
    sessionId: callId,
    vapiCallId: callId,
    source: "Vapi Server URL",
    channel: "Voice",
  };

  if (type.includes("transcript")) {
    const role = String(message?.role || message?.speaker || "").toLowerCase();
    return saveCallEvent({
      ...base,
      type: "transcript",
      speaker: role.includes("assistant") || role.includes("bot") || role.includes("agent") ? "AI Agent" : "Customer",
      text: message?.transcript || message?.text || message?.content || "",
      at: message?.timestamp || nowIso(),
      final: String(message?.transcriptType || "").toLowerCase() !== "partial",
      partial: String(message?.transcriptType || "").toLowerCase() === "partial",
    }, payload);
  }

  if (type.includes("end-of-call-report") || type.includes("ended") || type.includes("call-end")) {
    return saveCallEvent({
      ...base,
      type: "call-end",
      endedAt: message?.endedAt || message?.call?.endedAt || nowIso(),
      summary: message?.summary || message?.analysis?.summary || message?.artifact?.summary || "EC Calling Agent call ended.",
    }, payload);
  }

  if (type.includes("status") || type.includes("call-start") || type.includes("started")) {
    const status = String(message?.status || "").toLowerCase();
    return saveCallEvent({
      ...base,
      type: status.includes("ended") ? "call-end" : "call-start",
      startedAt: message?.startedAt || message?.call?.startedAt || nowIso(),
      endedAt: message?.endedAt || message?.call?.endedAt || null,
    }, payload);
  }

  return saveCallEvent({
    ...base,
    type: "call-start",
    startedAt: message?.call?.startedAt || nowIso(),
  }, payload);
}
