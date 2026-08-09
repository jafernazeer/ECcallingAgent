import React from "react";
import { EthikAqionHero, ExperienceNotes, GridBackground, MotionDecoration } from "./components/Hero.jsx";
import { PhoneMockup } from "./components/PhoneMockup.jsx";
import { LeadCaptured } from "./components/LeadCaptured.jsx";
import { EmailRecipients } from "./components/EmailRecipients.jsx";
import { useVapiCall } from "./lib/useVapiCall.js";

export default function App() {
  const call = useVapiCall();

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
          <LeadCaptured
            lead={call.lead}
            transcript={call.transcript}
            status={call.status}
            onClear={call.clearTestData}
          />

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
