import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Vapi from "@vapi-ai/web";
import { CheckCircle2, Mic2, Phone, PhoneCall, PhoneOff, Radio, ShieldCheck } from "lucide-react";
import "./styles.css";

const CALL_SOURCE = "Client agent test portal";
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY || "f80cea3b-d773-4f2c-88a8-8d7c87cd57ee";
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID || "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
const VAPI_API_BASE_URL = import.meta.env.VITE_VAPI_API_BASE_URL
  || (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api/vapi" : undefined);
const HAS_BROWSER_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL);
const DASHBOARD_EVENTS_URL = import.meta.env.VITE_DASHBOARD_EVENTS_URL
  || (!HAS_BROWSER_SUPABASE && typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:5172/api/call-events"
    : "");

function nowIso() {
  return new Date().toISOString();
}

const CUSTOMER_GOODBYE_PATTERN = /\b(bye|goodbye|that'?s all|that is all|no thanks|no thank you|thanks bye|thank you bye|ok bye|okay bye|see you)\b/i;
const AGENT_GOODBYE_PATTERN = /\b(bye|goodbye|thank you for contacting|have a great day|have a good day|take care)\b/i;

function isFinalTranscript(event) {
  return Boolean(event?.text) && event.final !== false && !event.partial;
}

function isCustomerGoodbye(text) {
  return CUSTOMER_GOODBYE_PATTERN.test(String(text || ""));
}

function isAgentGoodbye(text) {
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

async function persistCallEvent(event) {
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

function getVapiErrorMessage(error) {
  return toErrorText(error?.error)
    || toErrorText(error)
    || "The call could not be started. Check microphone permission and the configured assistant.";
}

function extractTranscriptFromVapiMessage(message) {
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

function normalizeSubmitLeadArgs(args) {
  const data = parseMaybeJson(args);
  if (!data || typeof data !== "object") return null;
  const lead = {
    name: String(data.customer_name || data.customerName || data.name || "").trim(),
    company: String(data.company_name || data.companyName || data.company || "").trim(),
    place: String(data.location || data.place || "").trim(),
    requirement: String(data.requirement_summary || data.requirementSummary || data.requirement || "").trim(),
    phone: String(data.contact_number || data.contactNumber || data.phone || "").trim(),
    email: String(data.email_id || data.emailId || data.email || "").trim(),
  };
  return lead.name || lead.company || lead.place || lead.requirement || lead.phone || lead.email ? lead : null;
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

function extractSubmitLeadEvents(message) {
  const seen = new Set();
  return collectToolCalls(message)
    .map((toolCall) => {
      const name = getToolName(toolCall);
      if (name !== "submit_lead") return null;
      const lead = normalizeSubmitLeadArgs(getToolArguments(toolCall));
      if (!lead) return null;
      const key = JSON.stringify(lead);
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

function useVapiCall() {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Ready to connect with EthikCorp Agent.");
  const [callStartedAt, setCallStartedAt] = useState("");
  const activeCallIdRef = useRef(null);
  const vapiRef = useRef(null);
  const audioRef = useRef(null);
  const endedCallIdsRef = useRef(new Set());
  const customerGoodbyePendingRef = useRef(false);
  const goodbyeTimeoutRef = useRef(null);
  const goodbyeFallbackRef = useRef(null);
  const eventQueueRef = useRef(Promise.resolve());
  const transcriptSnapshotRef = useRef([]);
  const leadSnapshotRef = useRef(null);

  function emit(event) {
    const queuedEvent = { source: CALL_SOURCE, ...event };
    const nextTask = eventQueueRef.current
      .catch(() => {})
      .then(() => persistCallEvent(queuedEvent));
    eventQueueRef.current = nextTask;
    return nextTask;
  }

  function mergeTranscriptSnapshot(transcriptEvent) {
    if (!transcriptEvent?.text?.trim()) return;
    const nextEntry = {
      speaker: transcriptEvent.speaker || "Customer",
      text: transcriptEvent.text.trim(),
      at: transcriptEvent.at || nowIso(),
      final: transcriptEvent.final !== false,
      partial: Boolean(transcriptEvent.partial),
    };
    const currentTranscript = transcriptSnapshotRef.current;
    const lastEntry = currentTranscript[currentTranscript.length - 1];
    const shouldReplacePartial = lastEntry?.partial && lastEntry.speaker === nextEntry.speaker;
    const isDuplicate = lastEntry?.speaker === nextEntry.speaker && lastEntry?.text === nextEntry.text;

    if (shouldReplacePartial) {
      transcriptSnapshotRef.current = [...currentTranscript.slice(0, -1), nextEntry];
    } else if (!isDuplicate) {
      transcriptSnapshotRef.current = [...currentTranscript, nextEntry];
    }
  }

  function resetCallSnapshots() {
    transcriptSnapshotRef.current = [];
    leadSnapshotRef.current = null;
  }

  function clearGoodbyeTimers() {
    if (goodbyeTimeoutRef.current) window.clearTimeout(goodbyeTimeoutRef.current);
    if (goodbyeFallbackRef.current) window.clearTimeout(goodbyeFallbackRef.current);
    goodbyeTimeoutRef.current = null;
    goodbyeFallbackRef.current = null;
    customerGoodbyePendingRef.current = false;
  }

  function cleanupCall(vapi) {
    clearGoodbyeTimers();
    activeCallIdRef.current = null;
    const activeVapi = vapi || vapiRef.current;
    activeVapi?.removeAllListeners?.();
    if (!vapi || vapiRef.current === vapi) vapiRef.current = null;
  }

  function finishCall(sessionId, reason = "EthikCorp Agent call ended.", options = {}) {
    if (!sessionId) return;
    const finalTranscript = transcriptSnapshotRef.current.filter((entry) => entry.text?.trim() && !entry.partial);
    const finalLead = leadSnapshotRef.current;
    setStatus("idle");
    setMessage("Call ended. You can start another test any time.");

    if (!endedCallIdsRef.current.has(sessionId)) {
      endedCallIdsRef.current.add(sessionId);
      emit({
        type: "call-end",
        sessionId,
        endedAt: nowIso(),
        summary: reason,
        message: reason,
        transcript: finalTranscript,
        lead: finalLead,
        source: CALL_SOURCE,
      });
    }

    if (options.stopProvider !== false) {
      try {
        (options.vapi || vapiRef.current)?.stop?.();
      } catch {
        // The provider may already have closed the call.
      }
    }

    cleanupCall(options.vapi);
    resetCallSnapshots();
  }

  function handleGoodbyeTranscript(transcriptEvent, sessionId) {
    if (!isFinalTranscript(transcriptEvent)) return;

    if (transcriptEvent.speaker === "Customer" && isCustomerGoodbye(transcriptEvent.text)) {
      customerGoodbyePendingRef.current = true;
      if (goodbyeFallbackRef.current) window.clearTimeout(goodbyeFallbackRef.current);
      goodbyeFallbackRef.current = window.setTimeout(() => {
        finishCall(sessionId, "Conversation closed after customer goodbye.");
      }, 8000);
    }

    if (transcriptEvent.speaker === "AI Agent" && customerGoodbyePendingRef.current && isAgentGoodbye(transcriptEvent.text)) {
      if (goodbyeFallbackRef.current) window.clearTimeout(goodbyeFallbackRef.current);
      if (goodbyeTimeoutRef.current) window.clearTimeout(goodbyeTimeoutRef.current);
      goodbyeTimeoutRef.current = window.setTimeout(() => {
        finishCall(sessionId, "Conversation closed after agent goodbye.");
      }, 1200);
    }
  }

  async function startCall() {
    if (status === "connecting" || status === "connected") return;
    const sessionId = `ec-agent-${Date.now()}`;
    const startedAt = nowIso();
    activeCallIdRef.current = sessionId;
    endedCallIdsRef.current.delete(sessionId);
    clearGoodbyeTimers();
    resetCallSnapshots();
    eventQueueRef.current = Promise.resolve();
    setCallStartedAt(startedAt);
    setStatus("connecting");
    setMessage("Requesting microphone access and connecting to EthikCorp Agent.");
    emit({ type: "call-created", sessionId, startedAt, channel: "Voice", source: CALL_SOURCE });

    const vapi = new Vapi(VAPI_PUBLIC_KEY, VAPI_API_BASE_URL);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setStatus("connected");
      setMessage("Call connected. Speak naturally.");
      emit({ type: "call-start", sessionId, startedAt, channel: "Voice", source: CALL_SOURCE });
    });

    vapi.on("message", (vapiMessage) => {
      const transcriptEvent = extractTranscriptFromVapiMessage(vapiMessage);
      if (transcriptEvent) {
        mergeTranscriptSnapshot(transcriptEvent);
        emit({ ...transcriptEvent, sessionId, source: CALL_SOURCE });
        handleGoodbyeTranscript(transcriptEvent, sessionId);
      }
      extractSubmitLeadEvents(vapiMessage).forEach((leadEvent) => {
        leadSnapshotRef.current = leadEvent.lead;
        emit({ ...leadEvent, sessionId, source: CALL_SOURCE });
      });
    });

    vapi.on("call-end", () => {
      finishCall(sessionId, "EthikCorp Agent call ended.", { vapi, stopProvider: false });
    });

    vapi.on("error", (error) => {
      const errorMessage = getVapiErrorMessage(error);
      setStatus("error");
      setMessage(errorMessage);
      emit({ type: "call-error", sessionId, endedAt: nowIso(), message: errorMessage, source: CALL_SOURCE });
    });

    try {
      await vapi.start(VAPI_ASSISTANT_ID);
    } catch (error) {
      const errorMessage = getVapiErrorMessage(error);
      setStatus("error");
      setMessage(errorMessage);
      emit({ type: "call-error", sessionId, endedAt: nowIso(), message: errorMessage, source: CALL_SOURCE });
    }
  }

  function endCall() {
    const sessionId = activeCallIdRef.current;
    finishCall(sessionId, "Call ended from the agent test portal.");
  }

  return { status, message, callStartedAt, startCall, endCall, audioRef };
}

function AgentPhone({ call }) {
  const connected = call.status === "connected";
  const connecting = call.status === "connecting";
  const hasError = call.status === "error";
  const statusLabel = connected ? "Live call active" : connecting ? "Connecting" : hasError ? "Attention needed" : "Ready to test";
  const readoutTitle = connected ? "Speak now" : connecting ? "Starting call" : hasError ? "Call not connected" : "Ready for your test call";

  return (
    <article className={`agent-phone ${connected ? "is-live" : ""} ${hasError ? "has-error" : ""}`} aria-label="EthikCorp Agent test phone">
      <div className="phone-speaker" />
      <div className="phone-screen">
        <header>
          <span>EC Calling Agent</span>
          <small>{statusLabel}</small>
        </header>

        <div className={`phone-orb ${connected ? "connected" : ""} ${hasError ? "error" : ""}`}>
          <Phone size={46} />
        </div>

        <section className="phone-readout" aria-live="polite">
          <strong>{readoutTitle}</strong>
          <p>{call.message}</p>
          {call.callStartedAt && <small>Session started {new Date(call.callStartedAt).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" })}</small>}
        </section>

        <div ref={call.audioRef} className="remote-audio" aria-live="polite" />

        <div className="phone-actions">
          <button type="button" disabled={connecting || connected} onClick={call.startCall}>
            <PhoneCall size={20} />
            Start Call
          </button>
          <button type="button" disabled={!connected && !connecting} onClick={call.endCall}>
            <PhoneOff size={20} />
            Disconnect
          </button>
        </div>
      </div>
    </article>
  );
}

function App() {
  const call = useVapiCall();
  const connected = call.status === "connected";
  const connecting = call.status === "connecting";

  return (
    <main className="portal-page">
      <section className="portal-shell">
        <header className="portal-header">
          <a href="/" aria-label="EthikCorp agent test portal home">
            <img src="/brand/ethikcorp-logo-blue.png" alt="EthikCorp" />
          </a>
          <span className={connected ? "live" : ""}>
            <Radio size={14} />
            {connected ? "Live" : connecting ? "Connecting" : "Agent test portal"}
          </span>
        </header>

        <div className="portal-content">
          <article className="portal-copy">
            <span className="kicker">EthikCorp Agent</span>
            <h1>Test the EC calling agent live.</h1>
            <p>
              Start a browser call, allow microphone access, and speak naturally. Captured lead details sync to the EthikCorp dashboard.
            </p>
            <div className="portal-benefits" aria-label="Portal capabilities">
              <span><Mic2 size={16} /> Browser voice test</span>
              <span><CheckCircle2 size={16} /> Lead capture sync</span>
              <span><ShieldCheck size={16} /> Secure dashboard flow</span>
            </div>
            <div className="portal-status">
              <span className={call.status === "connected" ? "live" : ""} />
              {call.status === "connected" ? "Agent is live" : call.status === "connecting" ? "Connecting" : "Ready to test"}
            </div>
          </article>

          <AgentPhone call={call} />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
