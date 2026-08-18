import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  Grid2X2,
  Mail,
  Moon,
  PhoneCall,
  Search,
  Smartphone,
  UsersRound,
} from "lucide-react";

const NAV = [
  { id: "overview", label: "Overview", icon: Grid2X2 },
  { id: "calls", label: "Call Transcripts", icon: PhoneCall, mobileLabel: "Calls" },
  { id: "leads", label: "Leads", icon: UsersRound },
  { id: "bookings", label: "Bookings", icon: CalendarDays },
  { id: "email", label: "Email Updates", icon: Mail, mobileLabel: "Email" },
  { id: "test", label: "Test Voice Agent", icon: Smartphone, mobileLabel: "Test" },
];

/** Heuristic quality score from how complete + confident the capture was. */
function scoreLead(lead) {
  if (!lead) return null;
  let score = 30;
  if (lead.customer_name) score += 12;
  if (lead.company_name) score += 12;
  if (lead.location) score += 8;
  if (lead.phone_number) score += 14;
  if (lead.email) score += 14;
  if (lead.requirement_summary) score += 10;
  if (lead.location_confidence === "low") score -= 8;
  if (lead.phone_confidence === "low") score -= 8;
  if (lead.email_confidence === "low") score -= 8;
  score = Math.max(0, Math.min(100, score));

  const tier = score >= 75 ? "hot" : score >= 50 ? "warm" : "cold";
  return { score, tier };
}

const TIER_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" };

function LeadRow({ lead, quality, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`crm-row ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <span className="crm-cell crm-profile">
        <strong>{lead.customer_name || "Unnamed caller"}</strong>
        <small>{lead.phone_number || "No number captured"}</small>
      </span>
      <span className="crm-cell crm-company">{lead.company_name || "—"}</span>
      <span className="crm-cell crm-quality">
        {quality && <span className={`chip-quality tier-${quality.tier}`}>{TIER_LABEL[quality.tier]} ({quality.score})</span>}
      </span>
      <span className="crm-cell crm-lang">{lead.service_area ? lead.service_area.replace(/_/g, " ") : "English"}</span>
      <span className="crm-cell crm-captured">{lead.capturedAt || "Just now"}</span>
    </button>
  );
}

function LeadDetail({ lead, quality }) {
  if (!lead) {
    return (
      <aside className="crm-detail is-empty">
        <p>Select a lead to see the full record.</p>
      </aside>
    );
  }

  const flagged = lead.needs_human_review
    || lead.location_confidence === "low"
    || lead.phone_confidence === "low"
    || lead.email_confidence === "low";

  return (
    <aside className="crm-detail">
      <div className="crm-detail-top">
        <span className="crm-id">LD_001</span>
        {quality && (
          <span className={`chip-quality tier-${quality.tier}`}>
            {TIER_LABEL[quality.tier]} Quality · Score {quality.score}/100
          </span>
        )}
      </div>

      <h3>{lead.customer_name || "Unnamed caller"}</h3>
      <p className="crm-detail-sub">
        {[lead.company_name, lead.location].filter(Boolean).join(" · ") || "Company not captured"}
      </p>

      <dl className="crm-detail-fields">
        <div><dt>Phone Number:</dt><dd>{lead.phone_number || "—"}</dd></div>
        <div><dt>Email Address:</dt><dd>{lead.email || "—"}</dd></div>
        <div><dt>Service Interest:</dt><dd>{lead.service_area ? lead.service_area.replace(/_/g, " ") : "—"}</dd></div>
        <div><dt>Lead Status:</dt><dd className="crm-status">{flagged ? "Needs review" : "Captured"}</dd></div>
      </dl>

      <div className="crm-notes">
        <span>Extracted transcript notes</span>
        <p>{lead.requirement_summary || "Requirement not captured on this call."}</p>
      </div>
    </aside>
  );
}

function TranscriptView({ transcript }) {
  if (!transcript.length) {
    return (
      <div className="crm-placeholder">
        <p>The transcript of your last call appears here once the call ends.</p>
      </div>
    );
  }

  return (
    <div className="crm-body crm-body-single">
      <div className="crm-table-card">
        <div className="crm-table-head">
          <strong>Last Call Transcript</strong>
          <span>{transcript.length} turns · captured live</span>
        </div>
        <ol className="crm-transcript">
          {transcript.map((entry) => (
            <li key={entry.id} className={`crm-turn from-${entry.speaker}`}>
              <span className="crm-turn-speaker">
                {entry.speaker === "agent" ? "EC Calling Agent" : "Caller"}
              </span>
              <p>{entry.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function LeadDashboard({ lead, transcript = [], callActive }) {
  const [activeNav, setActiveNav] = useState("leads");
  const [selected, setSelected] = useState(true);
  const quality = useMemo(() => scoreLead(lead), [lead]);
  const leads = lead ? [lead] : [];

  return (
    <section className="crm" aria-label="EthikCorp lead dashboard">
      <div className="crm-shell">
        {/* Sidebar — desktop */}
        <nav className="crm-sidebar" aria-label="Dashboard sections">
          <div className="crm-brand">
            <span className="crm-brand-mark">EC</span>
            <span className="crm-brand-text">
              <strong>EthikCorp</strong>
              <small>EC Calling Agent</small>
            </span>
          </div>

          <ul className="crm-nav">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={activeNav === item.id ? "crm-nav-item is-active" : "crm-nav-item"}
                    onClick={() => setActiveNav(item.id)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {item.label}
                    {item.id === "leads" && leads.length > 0 && <span className="crm-count">{leads.length}</span>}
                    {item.id === "calls" && transcript.length > 0 && <span className="crm-count">{transcript.length}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="crm-sidebar-foot">
            <span className="crm-brand-mark sm">EC</span>
            <span className="crm-brand-text">
              <strong>EthikCorp CRM</strong>
              <small>Live demo</small>
            </span>
          </div>
        </nav>

        {/* Main */}
        <div className="crm-main">
          <header className="crm-topbar">
            <div>
              <h2>{NAV.find((item) => item.id === activeNav)?.label || "Leads"}</h2>
              <p>Leads captured directly from live call transcripts</p>
            </div>
            <div className="crm-topbar-actions">
              <span className={`crm-live ${callActive ? "is-live" : ""}`}>
                <i aria-hidden="true" />
                {callActive ? "Call Live" : "EC Agent Ready"}
              </span>
              <span className="crm-avatar" aria-hidden="true"><Moon size={14} /></span>
            </div>
          </header>

          {activeNav === "calls" ? (
            <TranscriptView transcript={transcript} />
          ) : activeNav !== "leads" ? (
            <div className="crm-placeholder">
              <p>{NAV.find((item) => item.id === activeNav)?.label} is part of the full EthikCorp CRM.</p>
              <button type="button" className="btn btn-ghost" onClick={() => setActiveNav("leads")}>
                Back to Leads
              </button>
            </div>
          ) : (
            <>
              <div className="crm-toolbar">
                <span className="crm-search">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" placeholder="Search leads by name, company, or phone…" aria-label="Search leads" />
                </span>
                <span className="crm-filters">
                  <button type="button" className="crm-filter is-active">All Leads</button>
                  <button type="button" className="crm-filter">Hot</button>
                  <button type="button" className="crm-filter">Warm</button>
                  <button type="button" className="crm-filter">Cold</button>
                </span>
              </div>

              <div className="crm-body">
                <div className="crm-table-card">
                  <div className="crm-table-head">
                    <strong>Captured Leads ({leads.length})</strong>
                    <span>Auto-extracted from live call transcripts</span>
                  </div>

                  {leads.length === 0 ? (
                    <p className="crm-empty">
                      Your captured lead appears here the moment the call ends.
                    </p>
                  ) : (
                    <div className="crm-table" role="table">
                      <div className="crm-row crm-head" role="row">
                        <span>Lead Profile</span>
                        <span>Company</span>
                        <span>Quality</span>
                        <span>Interest</span>
                        <span>Captured</span>
                      </div>
                      {leads.map((item, index) => (
                        <LeadRow
                          key={index}
                          lead={item}
                          quality={quality}
                          selected={selected}
                          onSelect={() => setSelected(true)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <LeadDetail lead={selected ? lead : null} quality={quality} />
              </div>
            </>
          )}

          {/* Bottom tab bar — mobile */}
          <nav className="crm-tabbar" aria-label="Dashboard sections">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={activeNav === item.id ? "crm-tab is-active" : "crm-tab"}
                  onClick={() => setActiveNav(item.id)}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{item.mobileLabel || item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </section>
  );
}
