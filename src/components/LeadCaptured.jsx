import React from "react";
import { CircleCheck, RotateCcw } from "lucide-react";
import { CALL_STATE } from "../lib/useVapiCall.js";

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "place", label: "Location" },
  { key: "phone", label: "Phone Number" },
  { key: "email", label: "Email ID" },
  { key: "requirement", label: "Requirement", wide: true },
];

const PHONE_RE = /^05[0-9]{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LeadField({ label, value, wide, invalid, unconfirmed }) {
  const filled = Boolean(value);
  return (
    <div className={`lead-field ${wide ? "is-wide" : ""} ${filled ? "is-filled" : ""}`}>
      <dt>{label}</dt>
      <dd>
        {!filled ? (
          <span className="lead-placeholder">—</span>
        ) : invalid ? (
          <span className="lead-flag">Needs verification</span>
        ) : (
          value
        )}
        {filled && !invalid && unconfirmed && (
          <span className="lead-badge">Unconfirmed — verify on callback</span>
        )}
      </dd>
    </div>
  );
}

function CallSummary({ transcript }) {
  return (
    <div className={`lead-field is-summary ${transcript.length ? "is-filled" : ""}`}>
      <dt>Call Summary</dt>
      <dd>
        {transcript.length ? (
          <ol className="summary-list" aria-label="Last call transcript">
            {transcript.map((entry, index) => (
              <li key={entry.id || `${entry.speaker}-${index}`}>
                <span>{entry.speaker === "agent" ? "EC Calling Agent" : "Customer"}</span>
                <p>{entry.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <span className="lead-placeholder">Transcript unavailable</span>
        )}
      </dd>
    </div>
  );
}

export function LeadCaptured({ lead, transcript = [], status, onClear }) {
  const processing = status === CALL_STATE.processing;
  const hasLead = Boolean(lead);
  const transcriptReady = status === CALL_STATE.processing
    || status === CALL_STATE.completed
    || status === CALL_STATE.idle
    || status === CALL_STATE.error;
  const capturedTranscript = transcriptReady ? transcript.filter((entry) => entry?.text?.trim()) : [];
  const hasCapture = hasLead || capturedTranscript.length > 0;

  return (
    <section className="section lead-section" aria-labelledby="lead-heading">
      <div className="section-card">
        <div className="section-head">
          <p className="eyebrow">Structured Intelligence</p>
          <h2 id="lead-heading">Lead Captured</h2>
          <p className="section-sub">
            Converts live conversations into structured lead data.
          </p>
        </div>

        <div className="lead-panel">
          {!hasCapture && !processing && (
            <div className="lead-empty">
              <p>Your captured lead and call summary will appear here after the call.</p>
            </div>
          )}

          {!hasCapture && processing && (
            <div className="lead-empty is-working">
              <p>Analysing conversation…</p>
            </div>
          )}

          {hasCapture && (
            <>
              <div className="lead-confirmation"><CircleCheck size={16} /> Current test call captured</div>
              <dl className="lead-grid">
                {FIELDS.map((field) => (
                  <LeadField
                    key={field.key}
                    label={field.label}
                    value={lead?.[field.key]}
                    wide={field.wide}
                    invalid={
                      (field.key === "phone" && Boolean(lead?.phone) && !PHONE_RE.test(lead.phone))
                      || (field.key === "email" && Boolean(lead?.email) && !EMAIL_RE.test(lead.email))
                    }
                    unconfirmed={
                      (field.key === "place" && lead?.locationConfidence === "low")
                      || (field.key === "phone" && lead?.phoneConfidence === "low")
                      || (field.key === "email" && lead?.emailConfidence === "low")
                    }
                  />
                ))}
                <CallSummary transcript={capturedTranscript} />
              </dl>
            </>
          )}
        </div>

        {hasCapture && (
          <button type="button" className="link-quiet" onClick={onClear}>
            <RotateCcw size={13} /> Clear test data
          </button>
        )}
      </div>
    </section>
  );
}
