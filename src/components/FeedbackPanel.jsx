import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Star } from "lucide-react";

const SCORES = [1, 2, 3, 4, 5];

/**
 * Three dimensions rather than one overall score. "It was a 3" tells you
 * nothing actionable; "natural 5, understood me 2" points straight at the
 * transcription rather than the voice.
 */
const CRITERIA = [
  { id: "natural", label: "How natural the conversation felt" },
  { id: "understanding", label: "How well it understood you" },
  { id: "responsiveness", label: "How quickly and smoothly it responded" },
];

const SCORE_LABEL = {
  1: "Poor",
  2: "Below expectations",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

export function FeedbackPanel({ completedCall }) {
  const [scores, setScores] = useState({});
  const [comment, setComment] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");
  const sessionRef = useRef("");

  const sessionId = completedCall?.sessionId || "";

  // A new call means a new rating - reset rather than carry the last one over.
  useEffect(() => {
    if (!sessionId || sessionId === sessionRef.current) return;
    sessionRef.current = sessionId;
    setScores({});
    setComment("");
    setState("idle");
    setError("");
  }, [sessionId]);

  const answered = useMemo(() => CRITERIA.filter((c) => scores[c.id]).length, [scores]);
  const canSubmit = answered > 0;

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit || state === "sending") return;
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          scores,
          comment: comment.trim(),
          submittedAt: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error(`feedback ${response.status}`);
      setState("sent");
    } catch {
      setState("error");
      setError("We couldn't send that just now. Please try again.");
    }
  }

  if (!completedCall) return null;

  if (state === "sent") {
    return (
      <section className="section feedback-section" aria-labelledby="feedback-heading">
        <div className="feedback-card is-done" role="status">
          <span className="feedback-done-mark" aria-hidden="true"><Check size={18} /></span>
          <div>
            <h2 id="feedback-heading">Thank you — that helps.</h2>
            <p>Your feedback goes straight to the team improving EC Calling Agent.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section feedback-section" aria-labelledby="feedback-heading">
      <form className="feedback-card" onSubmit={submit}>
        <div className="feedback-head">
          <p className="eyebrow">Your feedback</p>
          <h2 id="feedback-heading">
            We’d genuinely value your feedback on your experience with EC Calling Agent
          </h2>
          <p className="feedback-sub">
            Rate each part of the call from 1 to 5, and tell us anything else in your own words.
          </p>
        </div>

        <div className="feedback-criteria">
          {CRITERIA.map((criterion) => (
            <fieldset key={criterion.id} className="feedback-criterion">
              <legend>{criterion.label}</legend>
              <div className="feedback-scale-row" role="radiogroup" aria-label={criterion.label}>
                {SCORES.map((value) => {
                  const current = scores[criterion.id];
                  const active = current !== undefined && value <= current;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={current === value}
                      aria-label={`${criterion.label}: ${value} out of 5 — ${SCORE_LABEL[value]}`}
                      className={`feedback-star ${active ? "is-on" : ""}`}
                      onClick={() => setScores((s) => ({ ...s, [criterion.id]: value }))}
                    >
                      <Star size={20} aria-hidden="true" />
                      <span className="feedback-star-num">{value}</span>
                    </button>
                  );
                })}
                {/* Reserved space so picking a score never shifts the row. */}
                <span className="feedback-scale-label" aria-live="polite">
                  {scores[criterion.id] ? SCORE_LABEL[scores[criterion.id]] : ""}
                </span>
              </div>
            </fieldset>
          ))}
        </div>

        <div className="feedback-field">
          <label htmlFor="feedback-comment">What you liked or what could be improved</label>
          <textarea
            id="feedback-comment"
            rows={3}
            maxLength={600}
            placeholder="Tell us in your own words what worked and what would have made this call better."
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <span className="feedback-count">{comment.length}/600</span>
        </div>

        {error && <p className="feedback-error" role="alert">{error}</p>}

        <div className="feedback-actions">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || state === "sending"}>
            {state === "sending" ? "Sending…" : "Submit feedback"}
          </button>
          {!canSubmit && <span className="feedback-hint">Rate at least one of the three to continue</span>}
        </div>
      </form>
    </section>
  );
}
