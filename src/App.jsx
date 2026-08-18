import React from "react";
import { EthikAqionHero, ExperienceNotes, GridBackground, MotionDecoration } from "./components/Hero.jsx";
import { PhoneMockup } from "./components/PhoneMockup.jsx";
import { LeadDashboard } from "./components/LeadDashboard.jsx";
import { EmailRecipients } from "./components/EmailRecipients.jsx";
import { useRetellCall } from "./lib/useRetellCall.js";

export default function App() {
  const call = useRetellCall();

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
          <LeadDashboard lead={call.lead} callActive={call.isActive} />

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
