import { useCallback, useEffect, useRef, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";
import { CALL_SOURCE, isAgentGoodbye, nowIso, persistCallEvent } from "./callHelpers.js";
import { STORAGE_KEYS, readStored, removeStored, writeStored } from "./storage.js";

export const CALL_STATE = {
  idle: "idle",
  requestingPermission: "requesting_permission",
  connecting: "connecting",
  connected: "connected",
  ending: "ending",
  processing: "processing",
  completed: "completed",
  error: "error",
};

const STATE_MESSAGE = {
  [CALL_STATE.idle]: "Tap Start Call and talk naturally.",
  [CALL_STATE.requestingPermission]: "Allow microphone access to speak with EC Calling Agent.",
  [CALL_STATE.connecting]: "Establishing a secure line to EC Calling Agent.",
  [CALL_STATE.connected]: "Connected. Speak naturally.",
  [CALL_STATE.ending]: "Ending the call.",
  [CALL_STATE.processing]: "Analysing conversation…",
  [CALL_STATE.completed]: "Call completed. Your captured lead is below.",
  [CALL_STATE.error]: "The call could not be completed.",
};

export const ACTIVE_STATES = new Set([
  CALL_STATE.requestingPermission,
  CALL_STATE.connecting,
  CALL_STATE.connected,
  CALL_STATE.ending,
]);

const WEB_CALL_URL = import.meta.env.VITE_RETELL_WEB_CALL_URL || "/api/retell/web-call";
const LEAD_URL = import.meta.env.VITE_LEAD_URL || "/api/lead";

/**
 * The capture tools land server-side moments around hang-up, so poll briefly
 * for the merged record instead of reading it once and giving up.
 */
async function pollLead(callId, onLead, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${LEAD_URL}/${encodeURIComponent(callId)}`);
      const result = await response.json();
      if (result?.found && result.lead) {
        onLead(result.lead);
        if (result.tools?.includes("submit_lead")) return;
      }
    } catch {
      // Endpoint unavailable — keep the UI on its empty state.
    }
    await new Promise((resolve) => { window.setTimeout(resolve, 1500); });
  }
}

function friendlyError(error) {
  const raw = String(error?.message || error || "").toLowerCase();
  if (raw.includes("notallowed") || raw.includes("permission denied")) {
    return "We couldn't access your microphone. Enable microphone permission in your browser and try again.";
  }
  if (raw.includes("notfound") || raw.includes("device not found")) {
    return "No microphone was found. Connect a microphone and start the call again.";
  }
  if (raw.includes("notreadable")) {
    return "Your microphone is being used by another app. Close it and start the call again.";
  }
  if (raw.includes("token") || raw.includes("503") || raw.includes("failed to fetch")) {
    return "The calling service is unavailable right now. Please try again shortly.";
  }
  return "The call could not be started. Check your microphone permission and try again.";
}

/**
 * Retell delivers the FULL transcript array on every `update` event, with
 * roles of "agent" / "user". We map it straight onto the portal's display
 * model rather than merging deltas the way the Vapi integration had to.
 */
function toDisplayTranscript(entries = []) {
  return entries
    .filter((entry) => String(entry?.content || "").trim())
    .map((entry, index) => ({
      id: `t${index + 1}`,
      speaker: entry.role === "agent" ? "agent" : "user",
      text: String(entry.content).trim(),
      at: nowIso(),
      isFinal: true,
    }));
}

export function useRetellCall() {
  const [status, setStatus] = useState(CALL_STATE.idle);
  const [statusMessage, setStatusMessage] = useState(STATE_MESSAGE[CALL_STATE.idle]);
  const [errorInfo, setErrorInfo] = useState(null);
  const [transcript, setTranscript] = useState(() => readStored(STORAGE_KEYS.transcript, []) || []);
  const [lead, setLead] = useState(() => readStored(STORAGE_KEYS.lead, null));
  const [elapsed, setElapsed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState("");
  const [completedCall, setCompletedCall] = useState(null);

  const clientRef = useRef(null);
  const goodbyeTimerRef = useRef(null);
  const audioRef = useRef(null);
  const callIdRef = useRef("");
  const startedAtRef = useRef("");
  const elapsedRef = useRef(0);
  const transcriptRef = useRef([]);
  const endedRef = useRef(new Set());
  const eventQueueRef = useRef(Promise.resolve());

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  useEffect(() => {
    if (status !== CALL_STATE.connected) return undefined;
    const startedTs = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedTs) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => () => {
    if (goodbyeTimerRef.current) window.clearTimeout(goodbyeTimerRef.current);
    try { clientRef.current?.stopCall?.(); } catch { /* already closed */ }
  }, []);

  function applyState(next, message) {
    setStatus(next);
    setStatusMessage(message || STATE_MESSAGE[next] || "");
  }

  function emit(event) {
    const payload = { source: CALL_SOURCE, ...event };
    const task = eventQueueRef.current.catch(() => {}).then(() => persistCallEvent(payload));
    eventQueueRef.current = task;
    return task;
  }

  function finishCall(reason) {
    const sessionId = callIdRef.current;
    if (!sessionId || endedRef.current.has(sessionId)) return;
    endedRef.current.add(sessionId);

    const finalTranscript = transcriptRef.current;
    applyState(CALL_STATE.processing);

    emit({
      type: "call-end",
      sessionId,
      endedAt: nowIso(),
      summary: reason,
      message: reason,
      transcript: finalTranscript.map((entry) => ({
        speaker: entry.speaker === "agent" ? "AI Agent" : "Customer",
        text: entry.text,
        at: entry.at,
        final: true,
        partial: false,
      })),
      source: CALL_SOURCE,
    });

    writeStored(STORAGE_KEYS.transcript, finalTranscript);
    setIsMuted(false);
    setCompletedCall({
      sessionId,
      lead,
      transcript: finalTranscript,
      startedAt: startedAtRef.current,
      durationSeconds: elapsedRef.current,
    });

    eventQueueRef.current.catch(() => {}).then(() => applyState(CALL_STATE.completed));

    // Read the merged lead straight from the server's in-memory store.
    pollLead(sessionId, (fields) => {
      setLead(fields);
      writeStored(STORAGE_KEYS.lead, fields);
      setCompletedCall((current) => (current ? { ...current, lead: fields } : current));
    });
  }

  const startCall = useCallback(async () => {
    if (ACTIVE_STATES.has(status)) return;

    const startedAt = nowIso();
    startedAtRef.current = startedAt;
    transcriptRef.current = [];
    elapsedRef.current = 0;
    setTranscript([]);
    setLead(null);
    setCompletedCall(null);
    setErrorInfo(null);
    setElapsed(0);
    setIsMuted(false);
    applyState(CALL_STATE.requestingPermission);

    try {
      // The access token must be minted server-side — the Retell secret key
      // never reaches the browser.
      const response = await fetch(WEB_CALL_URL, { method: "POST" });
      if (!response.ok) throw new Error(`web-call ${response.status}`);
      const { accessToken, callId } = await response.json();
      if (!accessToken) throw new Error("No access token returned.");

      callIdRef.current = callId || `retell-${Date.now()}`;
      endedRef.current.delete(callIdRef.current);
      setCallStartedAt(startedAt);

      emit({ type: "call-created", sessionId: callIdRef.current, startedAt, channel: "Voice", source: CALL_SOURCE });

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on("call_started", () => {
        applyState(CALL_STATE.connected);
        emit({ type: "call-start", sessionId: callIdRef.current, startedAt, channel: "Voice", source: CALL_SOURCE });
      });

      client.on("update", (update) => {
        if (!Array.isArray(update?.transcript)) return;
        const next = toDisplayTranscript(update.transcript);
        transcriptRef.current = next;
        setTranscript(next);

        // The agent signs off but Retell keeps the session open, leaving the
        // caller to press End Call. Hang up ourselves once its closing line
        // lands, allowing a short beat for the audio to finish playing.
        const last = next[next.length - 1];
        if (last?.speaker === "agent" && isAgentGoodbye(last.text) && !goodbyeTimerRef.current) {
          goodbyeTimerRef.current = window.setTimeout(() => {
            goodbyeTimerRef.current = null;
            applyState(CALL_STATE.ending);
            try { client.stopCall(); } catch { /* already closed */ }
            finishCall("Call ended after the agent signed off.");
          }, 2600);
        }
      });

      client.on("call_ended", () => {
        if (goodbyeTimerRef.current) {
          window.clearTimeout(goodbyeTimerRef.current);
          goodbyeTimerRef.current = null;
        }
        finishCall("EthikCorp Agent call ended.");
      });

      client.on("error", (error) => {
        const message = friendlyError(error);
        setErrorInfo({ message });
        applyState(CALL_STATE.error, message);
        try { client.stopCall(); } catch { /* already closed */ }
      });

      applyState(CALL_STATE.connecting);
      await client.startCall({ accessToken });
    } catch (error) {
      const message = friendlyError(error);
      setErrorInfo({ message });
      applyState(CALL_STATE.error, message);
    }
  }, [status, lead]);

  const endCall = useCallback(() => {
    if (goodbyeTimerRef.current) {
      window.clearTimeout(goodbyeTimerRef.current);
      goodbyeTimerRef.current = null;
    }
    applyState(CALL_STATE.ending);
    try { clientRef.current?.stopCall?.(); } catch { /* already closed */ }
    finishCall("Call ended from the agent test portal.");
  }, [lead]);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    setIsMuted((current) => {
      try {
        if (current) client.unmute?.();
        else client.mute?.();
      } catch {
        return current;
      }
      return !current;
    });
  }, []);

  const clearTestData = useCallback(() => {
    removeStored(STORAGE_KEYS.lead);
    removeStored(STORAGE_KEYS.transcript);
    transcriptRef.current = [];
    setTranscript([]);
    setLead(null);
    setCompletedCall(null);
    setErrorInfo(null);
    setElapsed(0);
    setCallStartedAt("");
    applyState(CALL_STATE.idle);
  }, []);

  return {
    status,
    statusMessage,
    errorInfo,
    transcript,
    lead,
    elapsed,
    isMuted,
    callStartedAt,
    completedCall,
    isActive: ACTIVE_STATES.has(status),
    startCall,
    endCall,
    toggleMute,
    clearTestData,
    audioRef,
  };
}
