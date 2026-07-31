import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mic, Phone, PhoneCall, PhoneOff } from "lucide-react";
import "./styles.css";

const VAPI_PUBLIC_KEY = "f80cea3b-d773-4f2c-88a8-8d7c87cd57ee";
const VAPI_ASSISTANT_ID = "da9e9bf5-29e1-4d97-bd4b-f1dc3a97fe76";
const VAPI_ORG_ID = "7a20e8e2-726e-485e-8348-09fb9ef8e729";
const VAPI_AGENT_NAME = "EthikCorp Agent";
const VAPI_VOICE = {
  provider: "cartesia",
  model: "sonic-3.5",
  voiceId: "638efaaa-4d0c-442e-b701-3fae16aad012",
};

const EC_AGENT_SCRIPT = `
You are the EthikCorp Agent for inbound customer calls.

Conversation style:
- Be warm, calm, and client friendly.
- Keep every reply short: 1 to 2 sentences, under 35 words unless the caller asks for details.
- Ask one question at a time.
- Do not give long explanations, lists, or sales pitches during intake.

Call goal:
- Understand the caller's requirement and capture a complete lead for the EthikCorp dashboard.
- Collect these fields naturally: full name, company or organization if available, location or emirate, phone number, email address, requirement, preferred follow-up time, and urgency.
- If the browser or phone system already provides the calling number, still confirm the best callback number briefly.
- If the caller does not want to share email or company, mark it as not provided and continue.

Recommended flow:
1. Greet: "Hello, this is EthikCorp. How can I help you today?"
2. After the caller explains, ask: "May I have your full name?"
3. Ask: "Which company or organization are you calling from?"
4. Ask: "Which emirate or country are you based in?"
5. Ask: "What is the best callback number?"
6. Ask: "May I have your email for follow-up?"
7. Ask one concise clarification about the requirement if needed.
8. Ask: "When would you prefer our team to follow up?"
9. Confirm briefly: name, requirement, location, phone, email, and follow-up time.
10. Close politely: "Thank you. I will pass this to the EthikCorp team for follow-up."

EthikCorp context:
- EthikCorp helps UAE organizations with business transformation, corporate training, leadership development, organizational culture and change management, process improvement, digital transformation, and gamification or AR/VR solutions.
- For pricing, proposals, availability, and detailed consulting advice, collect the lead details and say the EthikCorp team will follow up.
- Do not promise exact pricing, delivery timelines, or guarantees during the call.

Lead capture rules:
- If a value is unclear, ask a short confirmation question.
- Always keep the call moving toward a complete lead record.
- Once full name, company, location, requirement, phone, and email are captured, call the submit_lead tool exactly once before closing the call.
`.trim();

const EC_AGENT_ASSISTANT_OVERRIDES = {
  name: VAPI_AGENT_NAME,
  metadata: {
    orgId: VAPI_ORG_ID,
    assistantId: VAPI_ASSISTANT_ID,
    portal: "ethikcorp-agent-test",
  },
  firstMessage: "Hello, this is EthikCorp. How can I help you today?",
  firstMessageMode: "assistant-speaks-first",
  voice: VAPI_VOICE,
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: EC_AGENT_SCRIPT,
      },
    ],
  },
};

const CALL_SOURCE = "Client agent test portal";

function nowIso() {
  return new Date().toISOString();
}

function extractTranscriptFromVapiMessage(message) {
  const type = String(message?.type || message?.message?.type || "").toLowerCase();
  const role = String(message?.role || message?.message?.role || message?.speaker || "").toLowerCase();
  const transcriptType = String(message?.transcriptType || message?.message?.transcriptType || "").toLowerCase();
  const text = message?.transcript || message?.text || message?.message?.content || message?.content;
  if (!text || (!type.includes("transcript") && !role)) return null;

  return {
    speaker: role.includes("assistant") || role.includes("bot") || role.includes("agent") ? "AI Agent" : "Customer",
    text: String(text),
    final: transcriptType !== "partial",
    partial: transcriptType === "partial",
  };
}

function persistCallEvent(event) {
  if (!event?.sessionId) return;
  fetch("/api/call-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: CALL_SOURCE, ...event }),
  }).catch(() => {});
}

function useVapiCall() {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Ready to test.");
  const [callStartedAt, setCallStartedAt] = useState("");
  const vapiRef = useRef(null);
  const activeCallIdRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => {
      vapiRef.current?.stop?.();
    };
  }, []);

  function emit(event) {
    persistCallEvent({ source: CALL_SOURCE, ...event });
  }

  function getErrorMessage(error) {
    if (!error) return "Could not start the EthikCorp Agent call.";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    return error.message || error.error?.message || error.error || "Could not start the EthikCorp Agent call.";
  }

  async function getVapiClient() {
    if (vapiRef.current) return vapiRef.current;

    const module = await import("@vapi-ai/web");
    const Vapi = module.default?.default || module.default;
    const vapi = new Vapi(VAPI_PUBLIC_KEY);

    vapi.on("call-start", () => {
      setStatus("connected");
      setMessage("EthikCorp Agent is live. Speak now.");
      emit({ type: "call-start", sessionId: activeCallIdRef.current, startedAt: nowIso() });
    });

    vapi.on("call-end", () => {
      setStatus("idle");
      setMessage("Call disconnected. Ready for another test.");
      emit({ type: "call-end", sessionId: activeCallIdRef.current, endedAt: nowIso() });
      activeCallIdRef.current = null;
    });

    vapi.on("speech-start", () => setMessage("EthikCorp Agent is speaking."));
    vapi.on("speech-end", () => setMessage("Listening. You can speak now."));
    vapi.on("call-start-progress", () => setMessage("Connecting to EthikCorp Agent..."));

    vapi.on("call-start-failed", (event) => {
      const errorMessage = event?.error || "The EthikCorp Agent call could not start.";
      setStatus("error");
      setMessage(errorMessage);
      emit({ type: "call-error", sessionId: activeCallIdRef.current, endedAt: nowIso(), message: errorMessage });
    });

    vapi.on("error", (error) => {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      setMessage(errorMessage);
      emit({ type: "call-error", sessionId: activeCallIdRef.current, endedAt: nowIso(), message: errorMessage });
    });

    vapi.on("message", (event) => {
      const transcript = extractTranscriptFromVapiMessage(event);
      if (!transcript || !activeCallIdRef.current) return;
      emit({
        type: "transcript",
        sessionId: activeCallIdRef.current,
        at: nowIso(),
        ...transcript,
      });
    });

    vapiRef.current = vapi;
    return vapi;
  }

  async function startCall() {
    if (status === "connecting" || status === "connected") return;
    const sessionId = `ec-agent-${Date.now()}`;
    const startedAt = nowIso();
    activeCallIdRef.current = sessionId;
    setCallStartedAt(startedAt);
    setStatus("connecting");
    setMessage("Requesting microphone access...");
    emit({ type: "call-created", sessionId, startedAt });

    try {
      const vapi = await getVapiClient();
      await vapi.start(VAPI_ASSISTANT_ID, {
        ...EC_AGENT_ASSISTANT_OVERRIDES,
        metadata: {
          ...EC_AGENT_ASSISTANT_OVERRIDES.metadata,
          source: CALL_SOURCE,
          sessionId,
        },
      });
      setMessage("Connecting to EthikCorp Agent...");
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      setMessage(errorMessage);
      emit({ type: "call-error", sessionId, endedAt: nowIso(), message: errorMessage });
    }
  }

  function endCall() {
    const sessionId = activeCallIdRef.current;
    vapiRef.current?.stop?.();
    setStatus("idle");
    setMessage("Call disconnected. Ready for another test.");
    emit({ type: "call-end", sessionId, endedAt: nowIso() });
    activeCallIdRef.current = null;
  }

  return { status, message, callStartedAt, startCall, endCall, audioRef };
}

function AgentPhone({ call }) {
  const connected = call.status === "connected";
  const connecting = call.status === "connecting";
  const hasError = call.status === "error";

  return (
    <article className="agent-phone" aria-label="EthikCorp Agent test phone">
      <div className="phone-speaker" />
      <div className="phone-screen">
        <header>
          <span>EthikCorp Agent</span>
          <small>{connected ? "Live call active" : connecting ? "Connecting" : hasError ? "Attention needed" : "Ready to test"}</small>
        </header>

        <div className={`phone-orb ${connected ? "connected" : ""} ${hasError ? "error" : ""}`}>
          {connected ? <Mic size={46} /> : <Phone size={46} />}
        </div>

        <section className="phone-readout" aria-live="polite">
          <strong>{connected ? "Speak now" : connecting ? "Starting call" : hasError ? "Call not connected" : "Click Start Call"}</strong>
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

  return (
    <main className="portal-page">
      <section className="portal-shell">
        <header className="portal-header">
          <img src="/brand/ethikcorp-logo-blue.png" alt="EthikCorp" />
          <span>Agent test portal</span>
        </header>

        <div className="portal-content">
          <article className="portal-copy">
            <span className="kicker">EthikCorp Agent</span>
            <h1>Test the EC calling agent live</h1>
            <p>
              Start a browser call, allow microphone access, and speak naturally. Captured call details are sent to the EthikCorp dashboard.
            </p>
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
