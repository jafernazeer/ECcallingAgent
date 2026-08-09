import React from "react";
import { AudioLines, ScanText, UserRoundCheck } from "lucide-react";

/** The AqionLabs bone-and-hairline technical grid. */
export function GridBackground() {
  return <div className="grid-backdrop" aria-hidden="true" />;
}

/**
 * Atmospheric AqionLabs artwork. Desktop only, and skipped entirely when the
 * visitor prefers reduced motion — the assets are decorative, never content.
 */
export function MotionDecoration() {
  return (
    <div className="motion-decoration" aria-hidden="true">
      <img className="motion-wave" src="/motion/service-motion.svg" alt="" loading="lazy" decoding="async" />
    </div>
  );
}

const notes = {
  left: [
    { number: "01", icon: AudioLines, title: "Speak naturally", copy: "No forms. No scripts. Begin with a real conversation." },
    { number: "02", icon: ScanText, title: "Watch it understand", copy: "See each exchange become a clear live transcript." },
  ],
  right: [
    { number: "03", icon: UserRoundCheck, title: "Receive a qualified lead", copy: "Contact details and requirements become structured data." },
  ],
};

export function ExperienceNotes({ side }) {
  return (
    <aside className={`experience-notes notes-${side}`} aria-label={`${side} experience annotations`}>
      {notes[side].map(({ number, icon: Icon, title, copy }) => (
        <div className="experience-note" key={number}>
          <span className="note-number">{number}</span>
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          <strong>{title}</strong>
          <p>{copy}</p>
        </div>
      ))}
    </aside>
  );
}

/** EthikCorp × AqionLabs collaboration lockup and positioning statement. */
export function EthikAqionHero() {
  return (
    <header className="hero">
      <div className="lockup" aria-label="EthikCorp and AqionLabs">
        <img className="lockup-ethikcorp" src="/brand/ethikcorp-logo-blue.png" alt="EthikCorp" />
        <span className="lockup-x" aria-hidden="true">×</span>
        <span className="lockup-aqion">
          <img className="lockup-aqion-icon" src="/brand/aqionlabs-icon.png" alt="" aria-hidden="true" />
          <img className="lockup-aqion-wordmark" src="/brand/aqionlabs-wordmark.png" alt="AqionLabs ai" />
        </span>
      </div>

      <h1 className="hero-title" id="experience-title">
        <span className="hero-title-primary">Business Transformation,</span>
        <span className="hero-title-secondary">Now Powered by <em>Agentic AI</em></span>
      </h1>

      <p className="hero-sub">
        Talk to EC Calling Agent. Watch it listen, understand and turn your conversation into a qualified lead.
      </p>
    </header>
  );
}
