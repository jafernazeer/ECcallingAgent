import React, { useMemo, useState } from "react";
import { useRetellData, formatClock, formatWhen, callerNameFromSummary } from "../lib/useRetellData.js";
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

function LeadDetail({ lead, quality, callSummary }) {
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
        <p>{callSummary || lead.requirement_summary || "Requirement not captured on this call."}</p>
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

function CallsTab({ calls, selectedCall, openCall, loading }) {
  if (loading && !calls.length) return <div className="crm-placeholder"><p>Loading call history…</p></div>;
  if (!calls.length) return <div className="crm-placeholder"><p>No calls recorded yet. Start a call to see it here.</p></div>;

  return (
    <div className="crm-body">
      <div className="crm-table-card">
        <div className="crm-table-head">
          <strong>Past Call Records</strong>
          <span>{calls.length} calls</span>
        </div>
        <div className="call-list">
          {calls.map((call) => {
            const active = selectedCall?.callId === call.callId;
            const name = callerNameFromSummary(call.summary);
            return (
              <React.Fragment key={call.callId}>
                <button
                  type="button"
                  className={`call-row ${active ? "is-selected" : ""}`}
                  onClick={() => openCall(call.callId)}
                >
                  <span className="call-row-main">
                    <strong>{name || call.direction.replace(/_/g, " ")}</strong>
                    <small>{formatWhen(call.startedAt)}</small>
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
        {selectedCall ? <TranscriptPanel call={selectedCall} /> : <p className="crm-detail-empty-text">Select a call to read its transcript.</p>}
      </aside>
    </div>
  );
}

function TranscriptPanel({ call }) {
  if (!call) return null;
  if (call.loading) return <p className="crm-detail-empty-text">Loading transcript…</p>;
  if (call.error) return <p className="crm-detail-empty-text">That transcript could not be loaded.</p>;

  return (
    <div className="transcript-panel">
      <div className="crm-detail-top">
        <span className="crm-id">{call.callId?.slice(0, 18)}…</span>
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
    <div className="crm-placeholder">
      <p>No bookings captured so far.</p>
      <small className="crm-placeholder-note">Appointments will appear here once scheduling is connected.</small>
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
  // Live leads from Retell, with the in-call capture pinned first.
  const leads = useMemo(() => (lead ? [lead, ...retell.leads] : retell.leads), [lead, retell.leads]);
  const activeLead = leads[selectedIndex] || null;
  const quality = useMemo(() => scoreLead(activeLead), [activeLead]);
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
                    onClick={() => setActiveNav(item.id)}
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
            />
          ) : activeNav === "bookings" ? (
            <BookingsTab />
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
                          key={item.call_id || index}
                          lead={item}
                          quality={scoreLead(item)}
                          selected={selectedIndex === index}
                          onSelect={() => setSelectedIndex(index)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <LeadDetail lead={activeLead} quality={quality} callSummary={activeLead?.summary || latestSummary} />
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
