import React, { useCallback, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, Send, X } from "lucide-react";
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

export function EmailRecipients({ completedCall, lead, transcript = [], startedAt, durationSeconds }) {
  const initialRecipients = useRef(readStored(STORAGE_KEYS.recipients, []) || []).current;
  const [recipients, setRecipients] = useState(initialRecipients);
  const [savedRecipients, setSavedRecipients] = useState(initialRecipients);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [saved, setSaved] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef(null);

  const latestCall = useMemo(() => {
    if (completedCall?.lead || completedCall?.transcript?.length) return completedCall;
    if (!lead && !transcript.length) return null;
    return {
      sessionId: `manual-${Date.now()}`,
      lead,
      transcript,
      startedAt,
      durationSeconds,
    };
  }, [completedCall, durationSeconds, lead, startedAt, transcript]);

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

  async function handleSend() {
    const pending = draft.trim().toLowerCase();
    if (pending && !EMAIL_PATTERN.test(pending)) {
      setFeedback({ tone: "error", text: "Enter a valid email address before sending." });
      return;
    }

    const nextRecipients = pending && EMAIL_PATTERN.test(pending)
      ? [...new Set([...recipients, pending])]
      : recipients;

    if (!nextRecipients.length) {
      setFeedback({ tone: "error", text: "Add at least one recipient before sending." });
      return;
    }

    if (!latestCall?.lead && !latestCall?.transcript?.length) {
      setFeedback({ tone: "error", text: "Complete a call first, then send the captured details." });
      return;
    }

    if (pending && EMAIL_PATTERN.test(pending)) {
      setRecipients(nextRecipients);
      setDraft("");
    }
    writeStored(STORAGE_KEYS.recipients, nextRecipients);
    setSavedRecipients(nextRecipients);
    setSaved(true);
    setIsSending(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/email-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: nextRecipients,
          subject: "EC Calling Agent — call summary and captured lead",
          message: buildEmailSummary(latestCall),
          deliveryId: `${latestCall.sessionId || "manual"}-${Date.now()}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Email request failed.");
      if (result.configured === false) {
        setFeedback({ tone: "error", text: "Email delivery needs the SMTP backend. Deploy as Express or connect an email API." });
        return;
      }
      setFeedback({ tone: "ok", text: `Call summary sent to ${result.sent || nextRecipients.length} recipient(s).` });
    } catch {
      setFeedback({ tone: "error", text: "Email sending is unavailable in static-only deployment. Use the Express backend or an email API." });
    } finally {
      setIsSending(false);
    }
  }

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
              <div className="email-button-row">
                <button type="button" className="btn btn-ghost" onClick={handleSave} disabled={!recipients.length && !draft.trim()}>
                  {saved ? <Check size={16} /> : <Plus size={16} />}
                  Save
                  {!saved && <ArrowRight size={15} />}
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSend} disabled={isSending || (!recipients.length && !draft.trim())}>
                  {isSending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
