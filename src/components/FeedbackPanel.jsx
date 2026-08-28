import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Star } from "lucide-react";

const SCORES = [1, 2, 3, 4, 5];

const SCORE_LABEL = {
  1: "Poor",
  2: "Below expectations",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

/**
 * Reason chips are conditional on the score. Asking a happy caller "what went
 * wrong" reads as tone-deaf, and asking an unhappy one "what did you like"
 * wastes the one moment they are willing to tell you what to fix.
 */
const REASONS_LOW = [
  "Misheard my details",
  "Repeated itself",
  "Too slow to respond",
  "Sounded robotic",
  "Didn't answer my question",
  "Ended the call too early",
];

const REASONS_HIGH = [
  "Understood me clearly",
  "Natural to talk to",
  "Quick and efficient",
  "Got my details right",
  "Answered what I asked",
];

export function FeedbackPanel({ completedCall }) {
  const [score, setScore] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [comment, setComment] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");
  const sessionRef = useRef("");

  const sessionId = completedCall?.sessionId || "";

  // A new call means a new rating - reset rather than carry the last one over.
  useEffect(() => {
    if (!sessionId || sessionId === sessionRef.current) return;
    sessionRef.current = sessionId;
    setScore(null);
    setReasons([]);
    setComment("");
    setState("idle");
    setError("");
  }, [sessionId]);

  const chips = useMemo(() => (score && score <= 3 ? REASONS_LOW : REASONS_HIGH), [score]);

  function toggleReason(reason) {
    setReasons((current) => (
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason]
    ));
  }

  async function submit(event) {
    event.preventDefault();
    if (!score || state === "sending") return;
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          score,
          reasons,
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
          <h2 id="feedback-heading">Thank you — that helps.</h2>
          <p>Your rating goes straight to the team improving EC Calling Agent.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section feedback-section" aria-labelledby="feedback-heading">
      <form className="feedback-card" onSubmit={submit}>
        <div className="feedback-head">
          <p className="eyebrow">Your feedback</p>
          <h2 id="feedback-heading">How was that conversation?</h2>
          <p className="feedback-sub">
            Rate the call and tell us what to improve. It takes a few seconds and shapes the next version of the agent.
          </p>
        </div>

        <fieldset className="feedback-scale">
          <legend>Rate this call, 1 is poor and 5 is excellent</legend>
          <div className="feedback-scale-row" role="radiogroup" aria-label="Call rating">
            {SCORES.map((value) => {
              const active = score !== null && value <= score;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={score === value}
                  aria-label={`${value} out of 5 — ${SCORE_LABEL[value]}`}
                  className={`feedback-star ${active ? "is-on" : ""}`}
                  onClick={() => setScore(value)}
                >
                  <Star size={26} aria-hidden="true" />
                  <span className="feedback-star-num">{value}</span>
                </button>
              );
            })}
          </div>
          {/* Reserved height so choosing a score does not shift the form. */}
          <p className="feedback-scale-label" aria-live="polite">
            {score ? SCORE_LABEL[score] : " "}
          </p>
        </fieldset>

        {/* Progressive disclosure: the detail only appears once there is a score. */}
        {score !== null && (
          <>
            <fieldset className="feedback-reasons">
              <legend>{score <= 3 ? "What went wrong?" : "What worked well?"} <span>Optional</span></legend>
              <div className="feedback-chips">
                {chips.map((reason) => {
                  const selected = reasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={selected}
                      className={`feedback-chip ${selected ? "is-on" : ""}`}
                      onClick={() => toggleReason(reason)}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="feedback-field">
              <label htmlFor="feedback-comment">
                Anything else? <span>Optional</span>
              </label>
              <textarea
                id="feedback-comment"
                rows={3}
                maxLength={600}
                placeholder="Tell us in your own words what would have made this call better."
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <span className="feedback-count">{comment.length}/600</span>
            </div>
          </>
        )}

        {error && <p className="feedback-error" role="alert">{error}</p>}

        <div className="feedback-actions">
          <button type="submit" className="btn btn-primary" disabled={!score || state === "sending"}>
            {state === "sending" ? "Sending…" : "Submit feedback"}
          </button>
          {!score && <span className="feedback-hint">Pick a rating to continue</span>}
        </div>
      </form>
    </section>
  );
}
