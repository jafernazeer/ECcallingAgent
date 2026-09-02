import React, { useEffect, useRef } from "react";
import { EthikAqionHero, ExperienceNotes, GridBackground, MotionDecoration } from "./components/Hero.jsx";
import { PhoneMockup } from "./components/PhoneMockup.jsx";
import { LeadDashboard } from "./components/LeadDashboard.jsx";
import { EmailRecipients } from "./components/EmailRecipients.jsx";
import { FeedbackPanel } from "./components/FeedbackPanel.jsx";
import { useRetellCall } from "./lib/useRetellCall.js";

export default function App() {
  const call = useRetellCall();
  const resultsRef = useRef(null);
  // The completed call is restored from storage on mount, so without this the
  // scroll below fired on every reload and dropped the visitor into the leads
  // section instead of the phone they came to try.
  const scrolledFor = useRef(call.completedCall?.sessionId || "");

  // A finished call should land the caller on the thing we want from them.
  // The dashboard is above it and still reachable by scrolling up.
  useEffect(() => {
    const sessionId = call.completedCall?.sessionId;
    if (!sessionId || !resultsRef.current) return;
    // Only scroll for a call that finished while this page was open.
    if (scrolledFor.current === sessionId) return;
    scrolledFor.current = sessionId;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    resultsRef.current.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, [call.completedCall?.sessionId]);

  return (
    <div className="page">
      <GridBackground />

      <main>
        <section className="stage" aria-labelledby="experience-title">
          <MotionDecoration />
          <EthikAqionHero />

          <div className="installation">
            <ExperienceNotes side="left" />
            <PhoneMockup call={call} />
            <ExperienceNotes side="right" />
          </div>

          <p className="stage-caption">
            One conversation. Live understanding. A structured opportunity ready for your team.
          </p>
        </section>

        <div className="content-shell">
          <LeadDashboard
            lead={call.lead}
            transcript={call.transcript}
            callActive={call.isActive}
            completedCall={call.completedCall}
          />

          <div ref={resultsRef}>
            <FeedbackPanel completedCall={call.completedCall} />
          </div>

          <EmailRecipients
            completedCall={call.completedCall}
            lead={call.lead}
            transcript={call.transcript}
            startedAt={call.callStartedAt}
            durationSeconds={call.elapsed}
          />
        </div>
      </main>

      <footer className="page-footer">
        <span>EthikCorp × AqionLabs</span>
        <span>Agentic customer engagement, demonstrated live.</span>
      </footer>
    </div>
  );
}
