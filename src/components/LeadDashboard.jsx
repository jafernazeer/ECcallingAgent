import React, { useMemo, useState } from "react";
import { useRetellData, formatClock, formatWhen } from "../lib/useRetellData.js";
import {
  CalendarDays,
  Grid2X2,
  Mail,
  Moon,
  PhoneCall,
  Search,
  UsersRound,
  ChevronLeft,
} from "lucide-react";

const NAV = [
  { id: "overview", label: "Overview", icon: Grid2X2 },
  { id: "calls", label: "Call Transcripts", icon: PhoneCall, mobileLabel: "Calls" },
  { id: "leads", label: "Leads", icon: UsersRound },
  { id: "bookings", label: "Bookings", icon: CalendarDays },
  { id: "email", label: "Email Updates", icon: Mail, mobileLabel: "Email" },
];

/**
 * List cells show only the opening of each value; the full text is on the
 * record. Keeping every cell to the same short length is what holds the row
 * height constant no matter how long the captured data is.
 */
const SCORE_WORD = {
  1: "Poor",
  2: "Below expectations",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

const LIST_PREVIEW_CHARS = 5;

function preview(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > LIST_PREVIEW_CHARS ? `${text.slice(0, LIST_PREVIEW_CHARS)}..` : text;
}

/** Column order for the leads table; drives both the header and each row. */
const LEAD_COLUMNS = [
  { id: "name", label: "Name", get: (lead) => lead.customer_name },
  { id: "company", label: "Company", get: (lead) => lead.company_name },
  { id: "location", label: "Location", get: (lead) => lead.location },
  { id: "phone", label: "Contact Number", get: (lead) => lead.phone_number },
  { id: "email", label: "Email", get: (lead) => lead.email },
  { id: "requirement", label: "Requirement", get: (lead) => lead.requirement_summary },
];

function LeadRow({ lead, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`crm-row ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      {LEAD_COLUMNS.map((column) => {
        const value = column.get(lead);
        return (
          <span
            key={column.id}
            className={`crm-cell crm-col-${column.id} ${value ? "" : "is-empty"}`}
            /* Only the opening is shown; the full value stays reachable here
               and in full on the record. */
            title={value || undefined}
          >
            {preview(value) || "—"}
          </span>
        );
      })}
    </button>
  );
}

function LeadDetail({ lead, callSummary, onBack }) {
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
      <DetailBackBar label="All leads" onBack={onBack} />
      <div className="crm-detail-top">
        <span className="crm-id">{lead.call_id ? `${lead.call_id.slice(0, 14)}…` : "New lead"}</span>
        <span className={`crm-status-chip ${flagged ? "is-review" : "is-clear"}`}>
          {flagged ? "Needs review" : "Captured"}
        </span>
      </div>

      <h3>{lead.customer_name || "Unnamed caller"}</h3>
      <p className="crm-detail-sub">
        {[lead.company_name, lead.location].filter(Boolean).join(" · ") || "Company not captured"}
      </p>

      <dl className="crm-detail-fields">
        <div><dt>Name:</dt><dd>{lead.customer_name || "—"}</dd></div>
        <div><dt>Company:</dt><dd>{lead.company_name || "—"}</dd></div>
        <div><dt>Location:</dt><dd>{lead.location || "—"}</dd></div>
        <div><dt>Contact Number:</dt><dd className="crm-num">{lead.phone_number || "—"}</dd></div>
        <div><dt>Email:</dt><dd>{lead.email || "—"}</dd></div>
        <div><dt>Requirement:</dt><dd>{lead.requirement_summary || "—"}</dd></div>
      </dl>

      <div className="crm-notes">
        <span>{lead.requirement_source === "transcript" ? "Extracted transcript notes" : "AI call summary"}</span>
        <p>{callSummary || lead.requirement_summary || "Requirement not captured on this call."}</p>
      </div>

      {/* The caller's own verdict on the call, directly under the AI's account
          of it - the two read together or not at all. */}
      {lead.feedback && (
        <div className={`crm-notes crm-feedback tone-${lead.feedback.score <= 3 ? "low" : "high"}`}>
          <span>Caller feedback</span>
          <p className="crm-feedback-score">
            <strong>{lead.feedback.score}</strong>
            <span className="crm-feedback-outof">/ 5</span>
            <span className="crm-feedback-verdict">{SCORE_WORD[lead.feedback.score] || ""}</span>
          </p>
          {Array.isArray(lead.feedback.reasons) && lead.feedback.reasons.length > 0 && (
            <ul className="crm-feedback-reasons">
              {lead.feedback.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          {lead.feedback.comment && <p className="crm-feedback-comment">“{lead.feedback.comment}”</p>}
        </div>
      )}
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

function OverviewTab({ analytics, loading }) {
  const totals = analytics?.totals;
  const series = analytics?.series || [];
  const max = Math.max(1, ...series.map((row) => row.calls));

  if (loading && !totals) return <div className="crm-placeholder"><p>Loading live metrics…</p></div>;
  if (!totals) return <div className="crm-placeholder"><p>Live metrics are unavailable right now.</p></div>;

  const answeredPct = totals.calls ? Math.round((totals.answered / totals.calls) * 100) : 0;
  const successPct = totals.calls ? Math.round((totals.successful / totals.calls) * 100) : 0;

  const funnel = [
    { label: "Total Calls", value: totals.calls, pct: 100 },
    { label: "Answered", value: totals.answered, pct: answeredPct },
    { label: "Successful", value: totals.successful, pct: successPct },
  ];

  return (
    <div className="crm-body crm-body-single">
      <div className="kpi-row">
        <div className="kpi"><span className="kpi-label">Total Calls</span><strong>{totals.calls}</strong><small>{totals.answered} answered · {answeredPct}%</small></div>
        <div className="kpi"><span className="kpi-label">Successful</span><strong>{totals.successful}</strong><small>{successPct}% of calls</small></div>
        <div className="kpi"><span className="kpi-label">Avg Duration</span><strong>{formatClock(totals.avgDurationSeconds)}</strong><small>per conversation</small></div>
      </div>

      <div className="crm-table-card">
        <div className="crm-table-head"><strong>Call Volume</strong><span>Last {series.length} day(s)</span></div>
        <div className="spark">
          {series.map((row) => (
            <div key={row.day} className="spark-col" title={`${row.day}: ${row.calls} calls`}>
              <span className="spark-bar" style={{ height: `${Math.round((row.calls / max) * 100)}%` }} />
              <small>{row.day.slice(5)}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="crm-table-card">
        <div className="crm-table-head"><strong>Conversion Funnel</strong><span>Retell call analysis</span></div>
        <div className="funnel">
          {funnel.map((step) => (
            <div key={step.label} className="funnel-row">
              <span className="funnel-label">{step.label}</span>
              <span className="funnel-track"><span className="funnel-fill" style={{ width: `${step.pct}%` }} /></span>
              <span className="funnel-value">{step.value} <small>({step.pct}%)</small></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CallsTab({ calls, selectedCall, openCall, loading, detailOpen, setDetailOpen }) {
  if (loading && !calls.length) return <div className="crm-placeholder"><p>Loading call history…</p></div>;
  if (!calls.length) return <div className="crm-placeholder"><p>No calls recorded yet. Start a call to see it here.</p></div>;

  return (
    <div className={`crm-body crm-split ${detailOpen ? "is-detail-open" : ""}`}>
      <div className="crm-table-card">
        <div className="crm-table-head">
          <strong>Past Call Records</strong>
          <span>{calls.length} calls</span>
        </div>
        <div className="call-list">
          {calls.map((call) => {
            const active = selectedCall?.callId === call.callId;
            // Resolved server-side from the capture tools, post-call analysis
            // and summary, so it matches the name shown on the lead record.
            const name = call.callerName || "Unknown caller";
            return (
              <React.Fragment key={call.callId}>
                <button
                  type="button"
                  className={`call-row ${active ? "is-selected" : ""}`}
                  onClick={() => { openCall(call.callId); setDetailOpen(true); }}
                >
                  <span className="call-row-main">
                    <strong className={call.callerName ? "" : "is-unnamed"}>{name}</strong>
                    <small>{call.callerCompany ? `${call.callerCompany} · ${formatWhen(call.startedAt)}` : formatWhen(call.startedAt)}</small>
                  </span>
                  <span className="call-row-meta">
                    <span className="call-dur">{formatClock(call.durationSeconds)}</span>
                    {call.successful !== undefined && (
                      <span className={`chip-quality ${call.successful ? "tier-hot" : "tier-cold"}`}>
                        {call.successful ? "Successful" : "Incomplete"}
                      </span>
                    )}
                  </span>
                </button>
                {/* Mobile: transcript expands beneath the selected row */}
                {active && <div className="call-inline-transcript"><TranscriptPanel call={selectedCall} /></div>}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Desktop: transcript sits to the right */}
      <aside className="crm-detail call-detail-panel">
        <DetailBackBar label="All calls" onBack={() => setDetailOpen(false)} />
        {selectedCall ? <TranscriptPanel call={selectedCall} /> : <p className="crm-detail-empty-text">Select a call to read its transcript.</p>}
      </aside>
    </div>
  );
}

function DetailBackBar({ label, onBack }) {
  return (
    <button type="button" className="crm-back" onClick={onBack}>
      <ChevronLeft size={18} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function TranscriptPanel({ call }) {
  if (!call) return null;
  if (call.loading) return <p className="crm-detail-empty-text">Loading transcript…</p>;
  if (call.error) return <p className="crm-detail-empty-text">That transcript could not be loaded.</p>;

  return (
    <div className="transcript-panel">
      <div className="crm-detail-top">
        <span className="crm-id">{call.callerName || "Unknown caller"}</span>
        <span className="call-dur">{formatClock(call.durationSeconds)}</span>
      </div>
      {call.summary && (
        <div className="crm-notes">
          <span>AI Call Summary</span>
          <p>{call.summary}</p>
        </div>
      )}
      <ol className="crm-transcript">
        {call.transcript.map((turn) => (
          <li key={turn.id} className={`crm-turn from-${turn.speaker}`}>
            <span className="crm-turn-speaker">{turn.speaker === "agent" ? "EC Calling Agent" : "Caller"}</span>
            <p>{turn.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BookingsTab() {
  return (
    <>
      <div className="crm-toolbar">
        <div>
          <strong className="crm-toolbar-title">Client Bookings &amp; Consultations</strong>
          <span className="crm-toolbar-sub">Appointments auto-scheduled by EC Calling Agent</span>
        </div>
        <span className="crm-filters">
          <button type="button" className="crm-filter is-active">All</button>
          <button type="button" className="crm-filter">Confirmed</button>
          <button type="button" className="crm-filter">Pending</button>
          <button type="button" className="crm-filter">Completed</button>
        </span>
      </div>
      <div className="crm-body crm-body-single">
        <div className="crm-placeholder">
          <p>No bookings captured so far.</p>
          <small className="crm-placeholder-note">Confirmed appointments will appear here as cards — caller, company, phone, date &amp; time, and call context notes.</small>
        </div>
      </div>
    </>
  );
}

function EmailTab() {
  return (
    <div className="crm-body crm-body-email">
      <div className="crm-table-card">
        <div className="crm-table-head">
          <strong>Email Recipients (0)</strong>
          <span>Team members who receive live call summaries</span>
        </div>
        <div className="email-add-row">
          <input type="text" placeholder="Full Name" disabled />
          <input type="email" placeholder="email@company.com" disabled />
          <select disabled defaultValue="">
            <option value="" disabled>Role</option>
          </select>
          <button type="button" className="btn btn-primary" disabled>Add Recipient</button>
        </div>
        <p className="crm-empty">No recipients added yet.</p>
      </div>

      <div className="crm-table-card">
        <div className="crm-table-head">
          <strong>Notification Triggers</strong>
          <span>Choose when updates are sent to your team</span>
        </div>
        <ul className="trigger-list">
          <li>
            <div>
              <strong>Instant Call Summary Emails</strong>
              <p>Send lead details &amp; transcript summary immediately after each call</p>
            </div>
            <span className="toggle" aria-hidden="true" />
          </li>
          <li>
            <div>
              <strong>Daily Call Analytics Summary</strong>
              <p>Send a daily report of call volume, leads captured &amp; meetings booked</p>
            </div>
            <span className="toggle" aria-hidden="true" />
          </li>
          <li>
            <div>
              <strong>Hot Lead High-Priority Alerts</strong>
              <p>Urgent notification when a high-quality lead is qualified</p>
            </div>
            <span className="toggle" aria-hidden="true" />
          </li>
        </ul>
      </div>
    </div>
  );
}

export function LeadDashboard({ lead, transcript = [], callActive, completedCall }) {
  const [activeNav, setActiveNav] = useState("leads");
  const retell = useRetellData();

  // When a call just finished, pull fresh Retell data so the new lead,
  // transcript and analytics appear without a manual reload. Retell needs a
  // moment to analyse, so refresh once shortly after and again a little later.
  React.useEffect(() => {
    if (!completedCall?.sessionId) return undefined;
    const t1 = window.setTimeout(() => retell.refresh(), 2500);
    const t2 = window.setTimeout(() => retell.refresh(), 9000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedCall?.sessionId]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Phones drill down: the list fills the screen until a record is opened,
  // then the record takes over and Back returns. Wider screens ignore this
  // and keep both panes visible.
  const [detailOpen, setDetailOpen] = useState(false);
  // Live leads from Retell, with the in-call capture pinned first.
  // The just-captured lead is pinned first, but once Retell returns the same
  // call it arrives again from the server - key by call_id so it appears once.
  const leads = useMemo(() => {
    const combined = lead ? [lead, ...retell.leads] : retell.leads;
    const seen = new Set();
    return combined.filter((entry, index) => {
      const key = entry?.call_id || `row-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lead, retell.leads]);
  const activeLead = leads[selectedIndex] || null;
  // Retell's post-call analysis summary for the most recent call.
  const latestSummary = retell.calls[0]?.summary || "";

  return (
    <section className="section crm-section" aria-labelledby="crm-heading">
      <div className="section-card">
        <div className="section-head">
          <p className="eyebrow">Live CRM</p>
          <h2 id="crm-heading">Leads Captured</h2>
          <p className="section-sub">
            Every call the agent takes lands here — the lead it captured, the transcript it kept,
            and the summary it wrote.
          </p>
        </div>

        <div className="crm-device">
          <div className="crm-device-frame">
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
                    onClick={() => { setActiveNav(item.id); setDetailOpen(false); }}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {item.label}
                    {item.id === "leads" && leads.length > 0 && <span className="crm-count">{leads.length}</span>}
                    {item.id === "calls" && retell.calls.length > 0 && <span className="crm-count">{retell.calls.length}</span>}
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

          {activeNav === "overview" ? (
            <OverviewTab analytics={retell.analytics} loading={retell.loading} />
          ) : activeNav === "calls" ? (
            <CallsTab
              calls={retell.calls}
              selectedCall={retell.selectedCall}
              openCall={retell.openCall}
              loading={retell.loading}
              detailOpen={detailOpen}
              setDetailOpen={setDetailOpen}
            />
          ) : activeNav === "bookings" ? (
            <BookingsTab />
          ) : activeNav === "email" ? (
            <EmailTab />
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
                <span className="crm-count-pill">{leads.length} lead{leads.length === 1 ? "" : "s"}</span>
              </div>

              <div className={`crm-body crm-body-single crm-body-leads crm-split ${detailOpen ? "is-detail-open" : ""}`}>
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
                        {LEAD_COLUMNS.map((column) => (
                          <span key={column.id} className={`crm-col-${column.id}`}>{column.label}</span>
                        ))}
                      </div>
                      {leads.map((item, index) => (
                        <LeadRow
                          key={item.call_id || index}
                          lead={item}
                          selected={selectedIndex === index}
                          onSelect={() => { setSelectedIndex(index); setDetailOpen(true); }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <LeadDetail lead={activeLead} callSummary={activeLead?.summary || latestSummary} onBack={() => setDetailOpen(false)} />
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
          </div>
        </div>
      </div>
    </section>
  );
}
