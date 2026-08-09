import React, { useCallback, useEffect, useRef } from "react";
import { AudioWaveform, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Sparkles, TriangleAlert } from "lucide-react";
import { CALL_STATE } from "../lib/useVapiCall.js";
import { formatDuration } from "../lib/callHelpers.js";

function StatusPill({ status, elapsed }) {
  const map = {
    [CALL_STATE.idle]: { tone: "ready", label: "Ready" },
    [CALL_STATE.requestingPermission]: { tone: "pending", label: "Microphone" },
    [CALL_STATE.connecting]: { tone: "pending", label: "Connecting" },
    [CALL_STATE.connected]: { tone: "live", label: "Live" },
    [CALL_STATE.ending]: { tone: "pending", label: "Ending" },
    [CALL_STATE.processing]: { tone: "pending", label: "Analysing" },
    [CALL_STATE.completed]: { tone: "ready", label: "Completed" },
    [CALL_STATE.error]: { tone: "error", label: "Attention" },
  };
  const { tone, label } = map[status] || map[CALL_STATE.idle];

  return (
    <span className={`status-pill tone-${tone}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {label}
      {status === CALL_STATE.connected && <span className="status-timer">{formatDuration(elapsed)}</span>}
    </span>
  );
}

function Waveform({ active }) {
  return (
    <span className={`waveform ${active ? "is-active" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <i key={index} style={{ animationDelay: `${index * 90}ms` }} />
      ))}
    </span>
  );
}

function AgentHeader({ status, elapsed }) {
  return (
    <div className="agent-header">
      <div className="agent-identity-wrap">
        <span className="agent-mark" aria-hidden="true"><AudioWaveform size={16} /></span>
        <div className="agent-identity">
          <span className="agent-eyebrow">EthikCorp AI</span>
          <strong className="agent-name">EC Calling Agent</strong>
        </div>
      </div>
      <StatusPill status={status} elapsed={elapsed} />
    </div>
  );
}

/**
 * Live transcript with considerate auto-scroll: it follows the newest line, but
 * stops the moment the reader scrolls up, and resumes when they return.
 */
function LiveTranscript({ transcript, status }) {
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickToBottomRef.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  if (!transcript.length) {
    return (
      <div className="transcript-wrap">
        <p className="transcript-heading">Live Transcript</p>
        <div className="transcript transcript-empty">
          <p>Your call transcripts will appear on the screen as you speak.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript-wrap">
      <p className="transcript-heading">Live Transcript</p>
      <ol className="transcript" ref={scrollRef} onScroll={handleScroll} aria-live="polite" aria-label="Live call transcript">
        {transcript.map((entry) => (
          <li key={entry.id} className={`line from-${entry.speaker} ${entry.isFinal ? "" : "is-interim"}`}>
            <span className="line-speaker">{entry.speaker === "agent" ? "EC Calling Agent" : "You"}</span>
            <p className="line-text">{entry.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReadyScreen({ status, statusMessage }) {
  const requesting = status === CALL_STATE.requestingPermission;
  const helperCopy = requesting
    ? statusMessage
    : (
      <>
        <span>Watch the Conversation live</span>
        <span>as transcripts appear on the screen</span>
        <span className="copy-gap">Scroll down to view</span>
        <span>Captured Lead after the call</span>
      </>
    );

  return (
    <div className="phone-state">
      <div className={`voice-core ${requesting ? "is-pending" : ""}`} aria-hidden="true">
        <span className="voice-ring ring-one" />
        <span className="voice-ring ring-two" />
        <span className="voice-ring ring-three" />
        <span className="voice-core-button">
          {requesting ? <Mic size={25} /> : <Sparkles size={25} />}
        </span>
      </div>
      <strong className="state-title">
        {requesting ? (
          "Microphone access required"
        ) : (
          "Test Live Call Now"
        )}
      </strong>
      <p className="state-copy">{helperCopy}</p>
    </div>
  );
}

function ConnectingScreen({ statusMessage }) {
  return (
    <div className="phone-state">
      <span className="state-orb is-pending">
        <Loader2 size={26} className="spin" />
      </span>
      <strong className="state-title">Connecting</strong>
      <p className="state-copy">{statusMessage}</p>
    </div>
  );
}

function ProcessingScreen() {
  return (
    <div className="phone-state">
      <span className="state-orb is-pending">
        <Loader2 size={26} className="spin" />
      </span>
      <strong className="state-title">Call completed</strong>
      <p className="state-copy">Analysing conversation…</p>
    </div>
  );
}

function ErrorScreen({ statusMessage, onRetry }) {
  return (
    <div className="phone-state">
      <span className="state-orb is-error"><TriangleAlert size={26} /></span>
      <strong className="state-title">We couldn't start the call</strong>
      <p className="state-copy">{statusMessage}</p>
      <button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>
    </div>
  );
}

function CallControls({ status, isMuted, onStart, onEnd, onToggleMute }) {
  const inCall = status === CALL_STATE.connected;
  const busy = status === CALL_STATE.requestingPermission
    || status === CALL_STATE.connecting
    || status === CALL_STATE.ending
    || status === CALL_STATE.processing;

  if (inCall) {
    return (
      <div className="controls controls-live">
        <button
          type="button"
          className={`control-btn ${isMuted ? "is-active" : ""}`}
          onClick={onToggleMute}
          aria-pressed={isMuted}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          <span>{isMuted ? "Unmute" : "Mute"}</span>
        </button>
        <button type="button" className="control-btn control-end" onClick={onEnd} aria-label="End call">
          <PhoneOff size={20} />
          <span>End Call</span>
        </button>
      </div>
    );
  }

  return (
    <div className="controls">
      <button type="button" className="btn btn-primary btn-call" onClick={onStart} disabled={busy}>
        {busy ? <Loader2 size={18} className="spin" /> : <PhoneCall size={18} />}
        {status === CALL_STATE.completed || status === CALL_STATE.error ? "Start New Call" : "Start Call"}
      </button>
    </div>
  );
}

export function PhoneMockup({ call }) {
  const { status } = call;
  const showTranscript = status === CALL_STATE.connected
    || status === CALL_STATE.ending;

  return (
    <div className={`phone ${status === CALL_STATE.connected ? "is-live" : ""} ${status === CALL_STATE.error ? "has-error" : ""}`}>
      <span className="phone-side-button side-volume-up" aria-hidden="true" />
      <span className="phone-side-button side-volume-down" aria-hidden="true" />
      <span className="phone-side-button side-power" aria-hidden="true" />
      <div className="phone-frame">
        <div className="phone-screen">
          <span className="phone-island" aria-hidden="true"><i /></span>

          <AgentHeader status={status} elapsed={call.elapsed} />

          <div className="phone-body">
            {status === CALL_STATE.error && <ErrorScreen statusMessage={call.statusMessage} onRetry={call.startCall} />}
            {status === CALL_STATE.processing && <ProcessingScreen />}
            {status === CALL_STATE.connecting && <ConnectingScreen statusMessage={call.statusMessage} />}
            {(status === CALL_STATE.idle || status === CALL_STATE.requestingPermission || status === CALL_STATE.completed)
              && !showTranscript
              && <ReadyScreen status={status} statusMessage={call.statusMessage} />}
            {showTranscript && <LiveTranscript transcript={call.transcript} status={status} />}
          </div>

          {status === CALL_STATE.connected && (
            <div className="phone-visualizer">
              <Waveform active={!call.isMuted} />
              <span className="visualizer-label">{call.isMuted ? "Microphone muted" : "Listening"}</span>
            </div>
          )}

          <div ref={call.audioRef} className="remote-audio" />

          <CallControls
            status={status}
            isMuted={call.isMuted}
            onStart={call.startCall}
            onEnd={call.endCall}
            onToggleMute={call.toggleMute}
          />
        </div>
      </div>
      <span className="phone-shadow" aria-hidden="true" />
    </div>
  );
}
