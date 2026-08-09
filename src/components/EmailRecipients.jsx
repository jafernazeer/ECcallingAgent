import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import { STORAGE_KEYS, readStored, writeStored } from "../lib/storage.js";
import { buildEmailSummary } from "../lib/callHelpers.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RecipientChip({ email, onRemove }) {
  return (
    <span className="chip">
      {email}
      <button type="button" onClick={() => onRemove(email)} aria-label={`Remove ${email}`}>
        <X size={13} />
      </button>
    </span>
  );
}

export function EmailRecipients({ completedCall }) {
  const initialRecipients = useRef(readStored(STORAGE_KEYS.recipients, []) || []).current;
  const [recipients, setRecipients] = useState(initialRecipients);
  const [savedRecipients, setSavedRecipients] = useState(initialRecipients);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef(null);
  const deliveredRef = useRef(new Set());

  const addRecipient = useCallback((raw) => {
    const email = String(raw || "").trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_PATTERN.test(email)) {
      setFeedback({ tone: "error", text: "Enter a valid email address." });
      return;
    }
    let duplicate = false;
    setRecipients((current) => {
      if (current.includes(email)) {
        duplicate = true;
        return current;
      }
      return [...current, email];
    });
    if (duplicate) {
      setFeedback({ tone: "error", text: "That address is already on the list." });
      return;
    }
    setDraft("");
    setSaved(false);
    setFeedback(null);
  }, []);

  const removeRecipient = useCallback((email) => {
    setRecipients((current) => current.filter((item) => item !== email));
    setSaved(false);
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      if (!draft.trim()) return;
      event.preventDefault();
      addRecipient(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && recipients.length) {
      removeRecipient(recipients[recipients.length - 1]);
    }
  }

  function handleSave() {
    const pending = draft.trim().toLowerCase();
    if (pending && !EMAIL_PATTERN.test(pending)) {
      setFeedback({ tone: "error", text: "Enter a valid email address before saving." });
      return;
    }
    const next = pending && EMAIL_PATTERN.test(pending)
      ? [...new Set([...recipients, pending])]
      : recipients;

    if (pending && EMAIL_PATTERN.test(pending)) {
      setRecipients(next);
      setDraft("");
    }

    writeStored(STORAGE_KEYS.recipients, next);
    setSavedRecipients(next);
    setSaved(true);
    setFeedback({ tone: "ok", text: "Notification recipients saved" });
  }

  // Deliver the summary once per completed call, never on re-render or refresh.
  useEffect(() => {
    if (!completedCall?.sessionId) return;
    if (!savedRecipients.length) return;
    if (deliveredRef.current.has(completedCall.sessionId)) return;
    deliveredRef.current.add(completedCall.sessionId);

    fetch("/api/email-updates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: savedRecipients,
        subject: "EC Calling Agent — call summary and captured lead",
        message: buildEmailSummary(completedCall),
        deliveryId: completedCall.sessionId,
      }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((result) => {
        if (result?.ok && result.configured === false) {
          setFeedback({ tone: "error", text: "Email delivery is not configured on the server yet." });
        } else if (result?.ok) {
          setFeedback({ tone: "ok", text: `Call summary sent to ${result.sent || savedRecipients.length} recipient(s)` });
        }
      })
      .catch(() => {
        deliveredRef.current.delete(completedCall.sessionId);
        setFeedback({ tone: "error", text: "We couldn't send the call summary. Try saving again." });
      });
  }, [completedCall, savedRecipients]);

  return (
    <section className="section email-section" aria-labelledby="email-heading">
      <div className="section-card">
        <div className="section-head">
          <p className="eyebrow">Distribution</p>
          <h2 id="email-heading">Send Call Insights</h2>
          <p className="section-sub">
            Share transcripts and captured leads with your team.
          </p>
        </div>

        <div className="email-panel">
          <div className="email-form">
            <label className="field-label" htmlFor="recipient-input">Notification recipients</label>

            <div className="chip-input" onClick={() => inputRef.current?.focus()}>
              {recipients.map((email) => (
                <RecipientChip key={email} email={email} onRemove={removeRecipient} />
              ))}
              <input
                id="recipient-input"
                ref={inputRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={recipients.length ? "Add another…" : "operations@company.com"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                aria-describedby="recipient-hint"
              />
            </div>

            <div className="email-actions">
              <p id="recipient-hint" className={`field-hint ${feedback ? `tone-${feedback.tone}` : ""}`}>
                {feedback ? feedback.text : "Press Enter to add each address."}
              </p>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!recipients.length && !draft.trim()}>
                {saved ? <Check size={16} /> : <Plus size={16} />}
                Save Configuration
                {!saved && <ArrowRight size={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
