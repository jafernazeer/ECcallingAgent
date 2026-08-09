import { useCallback, useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import {
  CALL_SOURCE,
  extractSubmitLeadEvents,
  extractTranscriptFromVapiMessage,
  extractVapiCallId,
  fetchCompletedCallRecordByIds,
  getFriendlyCallError,
  getVapiClientConfig,
  isAgentGoodbye,
  isCustomerGoodbye,
  isFinalTranscript,
  nowIso,
  persistCallEvent,
  requestMicrophoneAccess,
} from "./callHelpers.js";
import { STORAGE_KEYS, readStored, removeStored, writeStored } from "./storage.js";

/**
 * Explicit call lifecycle. Every UI surface derives from exactly one of these
 * values, so impossible combinations (e.g. "connecting AND completed") cannot
 * be represented.
 */
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
  [CALL_STATE.idle]: "Talk to our AI agent and experience intelligent customer engagement in real time.",
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

/** Legacy wire speaker label -> display model speaker. */
function toDisplaySpeaker(speaker) {
  return speaker === "AI Agent" ? "agent" : "user";
}

function toDisplayTranscript(entries, sessionId) {
  return (entries || [])
    .filter((entry) => entry?.text?.trim() && !entry.partial)
    .map((entry, index) => ({
      id: entry.id || `${sessionId}-t${index + 1}`,
      speaker: entry.speaker === "agent" || entry.speaker === "user"
        ? entry.speaker
        : toDisplaySpeaker(entry.speaker),
      text: entry.text.trim(),
      at: entry.at || nowIso(),
      isFinal: entry.isFinal !== false && entry.final !== false,
    }));
}

export function useVapiCall() {
  const [status, setStatus] = useState(CALL_STATE.idle);
  const [statusMessage, setStatusMessage] = useState(STATE_MESSAGE[CALL_STATE.idle]);
  const [errorInfo, setErrorInfo] = useState(null);
  const [transcript, setTranscript] = useState(() => readStored(STORAGE_KEYS.transcript, []) || []);
  const [lead, setLead] = useState(() => readStored(STORAGE_KEYS.lead, null));
  const [elapsed, setElapsed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState("");
  const [completedCall, setCompletedCall] = useState(null);

  const activeCallIdRef = useRef(null);
  const externalCallIdRef = useRef("");
  const vapiRef = useRef(null);
  const audioRef = useRef(null);
  const endedCallIdsRef = useRef(new Set());
  const customerGoodbyePendingRef = useRef(false);
  const goodbyeTimeoutRef = useRef(null);
  const goodbyeFallbackRef = useRef(null);
  const eventQueueRef = useRef(Promise.resolve());
  // Legacy-shaped snapshot: this is what gets POSTed to the dashboard.
  const transcriptSnapshotRef = useRef([]);
  // Display-shaped snapshot: this is what renders inside the phone.
  const displayTranscriptRef = useRef([]);
  const leadSnapshotRef = useRef(null);
  const startedAtRef = useRef("");
  const elapsedRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // Call timer — runs only while genuinely connected.
  useEffect(() => {
    if (status !== CALL_STATE.connected) return undefined;
    const startedTs = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedTs) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  function applyState(nextState, message) {
    setStatus(nextState);
    setStatusMessage(message || STATE_MESSAGE[nextState] || "");
  }

  function emit(event) {
    const queuedEvent = {
      source: CALL_SOURCE,
      ...event,
      ...(event.externalCallId || !externalCallIdRef.current ? {} : { externalCallId: externalCallIdRef.current }),
    };
    const nextTask = eventQueueRef.current
      .catch(() => {})
      .then(() => persistCallEvent(queuedEvent));
    eventQueueRef.current = nextTask;
    return nextTask;
  }

  function linkExternalCallId(sessionId, externalCallId) {
    const normalized = String(externalCallId || "").trim();
    if (!sessionId || !normalized || externalCallIdRef.current === normalized) return;
    externalCallIdRef.current = normalized;
    emit({
      type: "call-linked",
      sessionId,
      externalCallId: normalized,
      at: nowIso(),
      source: CALL_SOURCE,
    });
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
    } else {
      return;
    }

    // Mirror into the display model, reusing ids so React keys stay stable
    // when a partial line is upgraded to its final text.
    const currentDisplay = displayTranscriptRef.current;
    const displayEntry = {
      id: shouldReplacePartial && currentDisplay.length
        ? currentDisplay[currentDisplay.length - 1].id
        : `t${(seqRef.current += 1)}`,
      speaker: toDisplaySpeaker(nextEntry.speaker),
      text: nextEntry.text,
      at: nextEntry.at,
      isFinal: !nextEntry.partial,
    };

    displayTranscriptRef.current = shouldReplacePartial
      ? [...currentDisplay.slice(0, -1), displayEntry]
      : [...currentDisplay, displayEntry];

    setTranscript(displayTranscriptRef.current);
  }

  function resetCallSnapshots() {
    transcriptSnapshotRef.current = [];
    displayTranscriptRef.current = [];
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
    if (!sessionId || endedCallIdsRef.current.has(sessionId)) return;
    endedCallIdsRef.current.add(sessionId);

    const finalTranscript = transcriptSnapshotRef.current.filter((entry) => entry.text?.trim() && !entry.partial);
    const finalDisplayTranscript = displayTranscriptRef.current.filter((entry) => entry.text?.trim() && entry.isFinal);
    const finalLead = leadSnapshotRef.current;
    const durationSeconds = elapsedRef.current;
    const externalCallId = externalCallIdRef.current;

    applyState(CALL_STATE.processing);

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

    if (options.stopProvider !== false) {
      try {
        (options.vapi || vapiRef.current)?.stop?.();
      } catch {
        // The provider may already have closed the call.
      }
    }

    cleanupCall(options.vapi);
    setIsMuted(false);

    // Settle persistence, then read the authoritative record back. The Vapi
    // submit_lead webhook can finish just after the last browser event.
    eventQueueRef.current
      .catch(() => {})
      .then(() => fetchCompletedCallRecordByIds({
        sessionId,
        externalCallId,
      }).catch(() => null))
      .then((record) => {
        const hydratedTranscript = record?.transcript?.length
          ? toDisplayTranscript(record.transcript, sessionId)
          : finalDisplayTranscript;
        const hydratedLead = record?.lead || finalLead;

        writeStored(STORAGE_KEYS.transcript, hydratedTranscript);
        if (hydratedLead) writeStored(STORAGE_KEYS.lead, hydratedLead);
        else removeStored(STORAGE_KEYS.lead);

        setTranscript(hydratedTranscript);
        setLead(hydratedLead);
        setCompletedCall({
          sessionId,
          lead: hydratedLead,
          transcript: hydratedTranscript,
          startedAt: startedAtRef.current,
          durationSeconds,
        });
        resetCallSnapshots();
        applyState(CALL_STATE.completed);
      });
  }

  function failCall(sessionId, error, vapi) {
    if (!sessionId || endedCallIdsRef.current.has(sessionId)) return;
    endedCallIdsRef.current.add(sessionId);
    const friendly = getFriendlyCallError(error);
    setErrorInfo(friendly);
    applyState(CALL_STATE.error, friendly.message);
    cleanupCall(vapi);
    emit({
      type: "call-error",
      sessionId,
      endedAt: nowIso(),
      message: friendly.message,
      transcript: transcriptSnapshotRef.current.filter((entry) => entry.text?.trim() && !entry.partial),
      lead: leadSnapshotRef.current,
      source: CALL_SOURCE,
    });
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

  const startCall = useCallback(async () => {
    if (ACTIVE_STATES.has(status)) return;

    const sessionId = `ec-agent-${Date.now()}`;
    const startedAt = nowIso();
    activeCallIdRef.current = sessionId;
    externalCallIdRef.current = "";
    endedCallIdsRef.current.delete(sessionId);
    clearGoodbyeTimers();
    resetCallSnapshots();
    eventQueueRef.current = Promise.resolve();
    startedAtRef.current = startedAt;
    elapsedRef.current = 0;

    setCallStartedAt(startedAt);
    setTranscript([]);
    setLead(null);
    setCompletedCall(null);
    setErrorInfo(null);
    setElapsed(0);
    setIsMuted(false);
    applyState(CALL_STATE.requestingPermission);

    try {
      await requestMicrophoneAccess();
    } catch (error) {
      const friendly = getFriendlyCallError(error);
      setErrorInfo(friendly);
      applyState(CALL_STATE.error, friendly.message);
      cleanupCall();
      return;
    }

    emit({ type: "call-created", sessionId, startedAt, channel: "Voice", source: CALL_SOURCE });

    const vapiConfig = await getVapiClientConfig();
    const vapi = new Vapi(vapiConfig.publicKey, vapiConfig.apiBaseUrl);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      applyState(CALL_STATE.connected);
      emit({ type: "call-start", sessionId, startedAt, channel: "Voice", source: CALL_SOURCE });
    });

    vapi.on("call-start-success", (event) => {
      linkExternalCallId(sessionId, extractVapiCallId(event));
    });

    vapi.on("message", (vapiMessage) => {
      linkExternalCallId(sessionId, extractVapiCallId(vapiMessage));
      const transcriptEvent = extractTranscriptFromVapiMessage(vapiMessage);
      if (transcriptEvent) {
        mergeTranscriptSnapshot(transcriptEvent);
        emit({ ...transcriptEvent, sessionId, source: CALL_SOURCE });
        handleGoodbyeTranscript(transcriptEvent, sessionId);
      }
      extractSubmitLeadEvents(vapiMessage).forEach((leadEvent) => {
        leadSnapshotRef.current = leadEvent.lead;
        setLead(leadEvent.lead);
        writeStored(STORAGE_KEYS.lead, leadEvent.lead);
        emit({ ...leadEvent, sessionId, source: CALL_SOURCE });
      });
    });

    vapi.on("call-end", () => {
      finishCall(sessionId, "EthikCorp Agent call ended.", { vapi, stopProvider: false });
    });

    vapi.on("error", (error) => {
      failCall(sessionId, error, vapi);
    });

    try {
      applyState(CALL_STATE.connecting);
      const startedCall = await vapi.start(vapiConfig.assistantId);
      linkExternalCallId(sessionId, extractVapiCallId(startedCall));
    } catch (error) {
      failCall(sessionId, error, vapi);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const endCall = useCallback(() => {
    const sessionId = activeCallIdRef.current;
    if (!sessionId) return;
    applyState(CALL_STATE.ending);
    finishCall(sessionId, "Call ended from the agent test portal.");
  }, []);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi?.setMuted) return;
    setIsMuted((current) => {
      const next = !current;
      try {
        vapi.setMuted(next);
      } catch {
        return current;
      }
      return next;
    });
  }, []);

  const clearTestData = useCallback(() => {
    removeStored(STORAGE_KEYS.lead);
    removeStored(STORAGE_KEYS.transcript);
    resetCallSnapshots();
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
