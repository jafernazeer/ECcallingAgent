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

  // The captured lead is the point of the call, but it renders below the fold.
  // Bring it into view the moment the call completes rather than leaving the
  // caller on a finished phone mockup wondering what happened.
  useEffect(() => {
    if (!call.completedCall?.sessionId || !resultsRef.current) return;
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

        <div className="content-shell" ref={resultsRef}>
          <LeadDashboard
            lead={call.lead}
            transcript={call.transcript}
            callActive={call.isActive}
            completedCall={call.completedCall}
          />

          <FeedbackPanel completedCall={call.completedCall} />

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
