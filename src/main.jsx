import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Gauge,
  Grid2X2,
  Headphones,
  Mail,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  PhoneOff,
  Search,
  Send,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const NAV_ITEMS = [
  { id: "overview", label: "Dashboard", hint: "Voice analytics", icon: Grid2X2 },
  { id: "conversations", label: "Conversation", hint: "Transcripts", icon: Headphones },
  { id: "leads", label: "Lead Management", hint: "Captured clients", icon: UsersRound },
  { id: "email", label: "Email Updates", hint: "Call summaries", icon: Mail },
  { id: "test", label: "Diagnostics", hint: "EC agent QA", icon: PhoneCall },
];

const VAPI_PUBLIC_KEY = "ee1d4795-4453-4456-ba50-c42a3404e1c3";
const VAPI_ASSISTANT_ID = "429bb390-be3c-4b1e-bc3a-2a717917725c";
const EC_AGENT_SCRIPT = `
You are the EthikCorp EC Calling Agent for inbound customer calls.

Conversation style:
- Be warm, calm, and client friendly.
- Keep every reply short: 1 to 2 sentences, under 35 words unless the caller asks for details.
- Ask one question at a time.
- Do not give long explanations, lists, or sales pitches during intake.
- If the caller interrupts or sounds rushed, acknowledge and continue with the next essential question.

Call goal:
- Understand the caller's requirement and capture a complete lead for the EthikCorp dashboard.
- Collect these fields naturally: full name, company or organization if available, location or emirate, phone number, email address, requirement, preferred follow-up time, and urgency.
- If the browser or phone system already provides the calling number, still confirm the best callback number briefly.
- If the caller does not want to share email or company, mark it as not provided and continue.

Recommended flow:
1. Greet: "Hello, this is EthikCorp. How can I help you today?"
2. After the caller explains, ask: "May I have your full name?"
3. Ask: "Which company or organization are you calling from?"
4. Ask: "Which emirate or country are you based in?"
5. Ask: "What is the best callback number?"
6. Ask: "May I have your email for follow-up?"
7. Ask one concise clarification about the requirement if needed.
8. Ask: "When would you prefer our team to follow up?"
9. Confirm briefly: name, requirement, location, phone, email, and follow-up time.
10. Close politely: "Thank you. I will pass this to the EthikCorp team for follow-up."

EthikCorp context:
- EthikCorp helps UAE organizations with business transformation, corporate training, leadership development, organizational culture and change management, process improvement, digital transformation, and gamification or AR/VR solutions.
- For pricing, proposals, availability, and detailed consulting advice, collect the lead details and say the EthikCorp team will follow up.
- Do not promise exact pricing, delivery timelines, or guarantees during the call.

Lead capture rules:
- Repeat captured details only at the end unless clarification is needed.
- If a value is unclear, ask a short confirmation question.
- Always keep the call moving toward a complete lead record.
`.trim();
const EC_AGENT_ASSISTANT_OVERRIDES = {
  firstMessage: "Hello, this is EthikCorp. How can I help you today?",
  firstMessageMode: "assistant-speaks-first",
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: EC_AGENT_SCRIPT,
      },
    ],
  },
};
const SUPABASE_BROWSER_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_BROWSER_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const CALL_HISTORY_KEY = "ethikcorp.ec.callHistory.v1";
const EMAIL_RECIPIENTS_KEY = "ethikcorp.ec.emailRecipients.v1";
const EMAIL_UPDATES_KEY = "ethikcorp.ec.emailUpdates.v1";
const MAX_CALL_RECORDS = 80;
const MAX_VISIBLE_CALLS = 3;
const DEMO_CALL_ID_PATTERN = /^c-10\d+$/;
const WORKFLOW_STATUSES = ["Open", "Follow up required", "Closed"];
let dashboardSupabaseClient = null;

function nowIso() {
  return new Date().toISOString();
}

function useUaeClock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    time: currentTime.toLocaleTimeString("en-AE", {
      timeZone: "Asia/Dubai",
      hour: "2-digit",
      minute: "2-digit",
    }),
    date: currentTime.toLocaleDateString("en-AE", {
      timeZone: "Asia/Dubai",
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sameLocalDay(iso, date = new Date()) {
  const candidate = new Date(iso);
  return candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate();
}

function withinDays(iso, days) {
  return Date.now() - new Date(iso).getTime() <= days * 24 * 60 * 60 * 1000;
}

function formatRelativeTime(iso) {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatTranscriptTime(iso, index) {
  if (!iso) return `${index + 1} min`;
  return new Date(iso).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" });
}

function formatDisplayDate(iso) {
  return new Date(iso).toLocaleDateString("en-AE", {
    timeZone: "Asia/Dubai",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateInputValue(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function toLocalDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWorkflowStatus(record) {
  return WORKFLOW_STATUSES.includes(record.workflowStatus) ? record.workflowStatus : "Open";
}

function workflowStatusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function withinDateFilter(iso, fromDate, toDate) {
  const value = toDateInputValue(iso);
  if (!value) return !fromDate && !toDate;
  return (!fromDate || value >= fromDate) && (!toDate || value <= toDate);
}

function filterByDateRange(items, fromDate, toDate) {
  return items.filter((item) => withinDateFilter(item.dateValue || item.startedAt, fromDate, toDate));
}

function sortByDate(items, direction) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.dateValue).getTime();
    const bTime = new Date(b.dateValue).getTime();
    const diff = (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
    return direction === "asc" ? diff : -diff;
  });
}

function matchesQuery(values, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getDashboardSupabaseClient() {
  if (!SUPABASE_BROWSER_URL || !SUPABASE_BROWSER_ANON_KEY) return null;
  if (!dashboardSupabaseClient) {
    dashboardSupabaseClient = createClient(SUPABASE_BROWSER_URL, SUPABASE_BROWSER_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return dashboardSupabaseClient;
}

async function fetchServerCallRecords() {
  const response = await fetch("/api/call-records");
  if (!response.ok) throw new Error("Could not load live call records.");
  return response.json();
}

function persistCallEvent(event) {
  if (!event?.sessionId) return;
  fetch("/api/call-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {});
}

function persistWorkflowStatus(recordId, workflowStatus) {
  if (!recordId) return;
  fetch(`/api/calls/${encodeURIComponent(recordId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowStatus }),
  }).catch(() => {});
}

function loadEmailRecipients() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(EMAIL_RECIPIENTS_KEY) || "[]");
    return Array.isArray(stored) ? stored.join("\n") : "";
  } catch {
    return "";
  }
}

function loadEmailUpdates() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(EMAIL_UPDATES_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function loadCallRecords() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CALL_HISTORY_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((record) => record?.source !== "Dashboard demo" && !DEMO_CALL_ID_PATTERN.test(record?.id || ""))
      .slice(0, MAX_CALL_RECORDS);
  } catch {
    return [];
  }
}

function normalizeTranscriptEntry(entry) {
  if (Array.isArray(entry)) {
    return { speaker: entry[0] || "Customer", text: entry[1] || "", at: entry[2] || nowIso(), final: true };
  }
  return {
    speaker: entry?.speaker || "Customer",
    text: entry?.text || "",
    at: entry?.at || nowIso(),
    final: entry?.final !== false,
    partial: Boolean(entry?.partial),
  };
}

function transcriptText(record) {
  return (record.transcript || [])
    .map(normalizeTranscriptEntry)
    .map((entry) => entry.text)
    .join(" ");
}

function customerEntries(record) {
  return (record.transcript || [])
    .map(normalizeTranscriptEntry)
    .filter((entry) => entry.speaker === "Customer" && entry.text.trim());
}

function answerAfterAgentPrompt(entries, promptPattern) {
  const promptIndex = entries.findIndex((entry) => entry.speaker === "AI Agent" && promptPattern.test(entry.text));
  return promptIndex >= 0
    ? entries.slice(promptIndex + 1).find((entry) => entry.speaker === "Customer" && entry.text.trim())
    : null;
}

function cleanRequirement(value) {
  if (!value) return "";
  return value
    .replace(/\b(?:my name is|this is|i am|i'm|name is|call me)\b[^,.]*[,.]?/i, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.-]+|[,.-]+$/g, "");
}

function firstCustomerRequirement(record) {
  const entries = (record.transcript || []).map(normalizeTranscriptEntry);
  const promptedAnswer = answerAfterAgentPrompt(entries, /\b(how can i help|what.*requirement|what.*need|looking for|interested in|service|support|clarification)\b/i);
  const candidates = [promptedAnswer, ...customerEntries(record)].filter(Boolean);

  for (const entry of candidates) {
    const explicitMatch = entry.text.match(/\b(?:i need|we need|looking for|interested in|want|require|calling about|need help with|enquire about|inquire about)\s+(.{8,220})/i);
    const explicitRequirement = cleanRequirement(explicitMatch?.[1]);
    if (explicitRequirement.length > 8) return explicitRequirement;

    const requirement = cleanRequirement(entry.text);
    if (requirement.length > 18 && !/@/.test(entry.text)) return requirement;
  }

  return record.summary || "Live EC Calling Agent inquiry";
}

function cleanStatedName(value) {
  if (!value) return "";
  const cleaned = value
    .replace(/\b(?:from|in|at|with|for|and|my email|email|phone|number|calling|i need|we need|looking for|regarding|about)\b.*$/i, "")
    .replace(/[^a-zA-Z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  if (!words.length || words.some((word) => /^(from|email|phone|need|calling)$/i.test(word))) return "";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function extractCustomerName(record) {
  const entries = (record.transcript || []).map(normalizeTranscriptEntry);
  const afterPrompt = answerAfterAgentPrompt(entries, /\b(name|who am i speaking with|may i know|can i have your name|full name)\b/i);
  const candidateLines = [afterPrompt, ...customerEntries(record)].filter(Boolean);

  for (const entry of candidateLines) {
    const explicitMatch = entry.text.match(/\b(?:my name is|this is|i am|i'm|it's|its|name is|call me)\s+([a-zA-Z .'-]{2,80})/i);
    const explicitName = cleanStatedName(explicitMatch?.[1]);
    if (explicitName) return explicitName;

    if (afterPrompt && entry === afterPrompt) {
      const directName = cleanStatedName(entry.text);
      if (directName) return directName;
    }
  }

  return "";
}

function extractLeadPlace(record, body) {
  const entries = (record.transcript || []).map(normalizeTranscriptEntry);
  const afterPrompt = answerAfterAgentPrompt(entries, /\b(location|where are you based|which emirate|which country|based in)\b/i);
  const locationText = [afterPrompt?.text, body].filter(Boolean).join(" ");
  const explicitMatch = locationText.match(/\b(?:based in|from|in|located in)\s+(Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|UAE|Kuwait|Saudi Arabia|Qatar|Oman|Bahrain)\b/i);
  const placeMatch = locationText.match(/\b(Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|UAE|United Arab Emirates|Kuwait|Saudi Arabia|Qatar|Oman|Bahrain)\b/i);
  return record.lead?.place || explicitMatch?.[1] || placeMatch?.[1] || "Not captured";
}

function extractLeadDetails(record) {
  const body = transcriptText(record);
  const lowerBody = body.toLowerCase();
  const email = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || record.lead?.email || "Not provided";
  const phone = body.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ") || record.phone || "Browser call";
  const statedName = extractCustomerName(record);
  const name = statedName || record.lead?.name || record.name || `Website Caller ${record.id.slice(-4).toUpperCase()}`;
  const place = extractLeadPlace(record, body);
  const requirement = record.lead?.requirement || firstCustomerRequirement(record);
  const status = lowerBody.includes("training")
    ? "Training"
    : lowerBody.includes("callback") || lowerBody.includes("call back")
      ? "Callback"
      : lowerBody.includes("book") || lowerBody.includes("consultation") || lowerBody.includes("meeting")
        ? "Booked"
        : requirement.length > 20
          ? "Qualified"
          : "New";
  const score = Math.min(98, 52
    + (email !== "Not provided" ? 12 : 0)
    + (phone !== "Browser call" ? 10 : 0)
    + (name.startsWith("Website Caller") ? 0 : 10)
    + (requirement.length > 35 ? 10 : 0)
    + Math.min(14, (record.transcript || []).length * 2));

  return { name, place, phone, email, requirement, source: "Voice", score, status };
}

function summarizeCall(record) {
  const requirement = firstCustomerRequirement(record);
  if (requirement.length <= 120) return requirement;
  return `${requirement.slice(0, 117)}...`;
}

function recordToConversation(record) {
  const transcript = (record.transcript || []).map(normalizeTranscriptEntry).filter((entry) => entry.text.trim());
  const lead = extractLeadDetails(record);
  const workflowStatus = getWorkflowStatus(record);
  return {
    id: record.id,
    name: lead.name,
    company: record.company || lead.place,
    phone: lead.phone,
    date: formatDisplayDate(record.startedAt),
    dateValue: record.startedAt,
    time: formatRelativeTime(record.startedAt),
    status: workflowStatus,
    channel: "Voice",
    summary: record.summary || summarizeCall(record),
    transcript: transcript.length
      ? transcript.map((entry, index) => [entry.speaker, entry.text, formatTranscriptTime(entry.at, index)])
      : [["AI Agent", "Call started. Waiting for live transcript data from the EC Calling Agent.", "now"]],
  };
}

function recordToLead(record) {
  return {
    id: record.id,
    date: formatDisplayDate(record.startedAt),
    dateValue: record.startedAt,
    ...extractLeadDetails(record),
    status: getWorkflowStatus(record),
  };
}

function buildMetrics(records) {
  const currentLive = records.filter((record) => record.status === "connecting" || record.status === "connected").length;
  const today = records.filter((record) => sameLocalDay(record.startedAt)).length;
  const lastWeek = records.filter((record) => withinDays(record.startedAt, 7)).length;
  const lastMonth = records.filter((record) => withinDays(record.startedAt, 30)).length;
  const droppedByAgent = records.filter((record) => record.status === "error").length;
  const droppedByCustomer = records.filter((record) => record.status === "ended" && (record.transcript || []).length <= 1).length;
  return [
    { label: "Current live calls", value: formatNumber(currentLive), delta: currentLive ? "Active browser sessions" : "No active calls", icon: Activity, tone: "cyan" },
    { label: "AI calls today", value: formatNumber(today), delta: "Calls from widget tests", icon: PhoneCall, tone: "blue" },
    { label: "AI calls last week", value: formatNumber(lastWeek), delta: "Rolling 7-day call volume", icon: BarChart3, tone: "green" },
    { label: "AI calls last month", value: formatNumber(lastMonth), delta: "Rolling 30-day call volume", icon: Gauge, tone: "blue" },
    { label: "Dropped by AI agent", value: formatNumber(droppedByAgent), delta: "Connection or agent errors", icon: PhoneMissed, tone: "orange" },
    { label: "Dropped by customer", value: formatNumber(droppedByCustomer), delta: "Ended before transcript", icon: PhoneOff, tone: "red" },
  ];
}

function buildCallVolume(records) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const calls = records.filter((record) => sameLocalDay(record.startedAt, date)).length;
    return {
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      calls,
    };
  });
}

function buildSvgPath(points, maxValue) {
  if (!points.length) return "";
  const width = 920;
  const top = 44;
  const bottom = 224;
  const step = points.length === 1 ? width : width / (points.length - 1);
  return points.map((point, index) => {
    const x = Math.round(index * step);
    const y = Math.round(bottom - (point.calls / maxValue) * (bottom - top));
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
}

function buildActionQueue(records) {
  return records
    .filter((record) => getWorkflowStatus(record) !== "Closed")
    .map((record) => {
      const lead = extractLeadDetails(record);
      const status = getWorkflowStatus(record);
      const priority = status === "Follow up required" ? "High" : "Medium";
      return [priority, `${lead.name}: ${lead.requirement}`, `${status} · ${formatRelativeTime(record.startedAt)}`];
    })
    .slice(0, 3);
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, headers, rows) {
  const csv = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");
  downloadFile(filename, csv, "text/csv;charset=utf-8");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadExcelTable(filename, sheetTitle, headers, rows) {
  const tableRows = rows.map((row) => (
    `<tr>${row.map((value) => `<td>${String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`).join("")}</tr>`
  )).join("");
  const headerRows = headers.map((header) => `<th>${header}</th>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><h1>${sheetTitle}</h1><table><thead><tr>${headerRows}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  downloadFile(filename, html, "application/vnd.ms-excel;charset=utf-8");
}

function buildReportFilename(prefix, fromDate, toDate, extension) {
  const range = `${fromDate || "start"}-${toDate || "today"}`;
  return `${prefix}-${range}.${extension}`;
}

function parseEmailRecipients(value) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    .filter((item, index, list) => list.indexOf(item) === index);
}

function answeredCallRecords(records) {
  return records.filter((record) => (
    record.status === "ended"
    && (record.agentJoined || (record.transcript || []).length > 0)
  ));
}

function leadLines(leads, limit = 8) {
  if (!leads.length) return ["No lead details captured yet."];
  return leads.slice(0, limit).map((lead, index) => (
    `${index + 1}. ${lead.name} | ${lead.phone} | ${lead.email} | ${lead.place} | ${lead.status} | ${lead.requirement}`
  ));
}

function buildSingleEmailSummary(record) {
  if (!record) {
    return "EthikCorp EC Calling Agent update\n\nNo answered call is selected yet.";
  }

  const lead = extractLeadDetails(record);
  return [
    "EthikCorp EC Calling Agent update",
    "",
    `Call date: ${formatDisplayDate(record.startedAt)}`,
    `Caller: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Location: ${lead.place}`,
    `Status: ${getWorkflowStatus(record)}`,
    "",
    "Requirement:",
    lead.requirement,
    "",
    "Call summary:",
    record.summary || summarizeCall(record),
    "",
    "Recommended next step:",
    getWorkflowStatus(record) === "Closed" ? "No open follow-up required." : "EthikCorp team should review and follow up with the caller.",
  ].join("\n");
}

function buildDigestEmailSummary(records, leads) {
  const answered = answeredCallRecords(records);
  const latestAnswered = answered[0];
  const latestLead = latestAnswered ? extractLeadDetails(latestAnswered) : null;
  return [
    "EthikCorp EC Calling Agent daily update",
    "",
    `Answered calls: ${answered.length}`,
    `Captured leads: ${leads.length}`,
    "",
    "Latest answered call:",
    latestLead
      ? `${latestLead.name} | ${latestLead.phone} | ${latestLead.place} | ${latestLead.requirement}`
      : "No answered calls captured yet.",
    "",
    "Captured lead details:",
    ...leadLines(leads),
  ].join("\n");
}

async function sendEmailUpdate(recipients, subject, message) {
  const response = await fetch("/api/email-updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipients, subject, message }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || "Could not send email update.");
  }
  return response.json();
}

async function fetchLatestVapiUpdate() {
  const response = await fetch("/api/vapi/latest");
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || "Could not fetch the latest Vapi update.");
  }
  return response.json();
}

function buildEmailUpdateRecord({ callId = "digest", recipients, message, status = "sending", result = null, error = "" }) {
  return {
    id: `email-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    callId,
    recipients,
    message,
    status,
    sentAt: nowIso(),
    result,
    error,
  };
}

function callDropSummary(records) {
  const total = records.length;
  const droppedByAgent = records.filter((record) => record.status === "error").length;
  const attended = records.filter((record) => record.status === "ended" && (record.transcript || []).length > 1).length;
  return {
    total,
    droppedByAgent,
    droppedByAgentPct: total ? `${Math.round((droppedByAgent / total) * 100)}%` : "0%",
    attended,
    attendedPct: total ? `${Math.round((attended / total) * 100)}%` : "0%",
  };
}

function dailyCallRows(records, fromDate, toDate) {
  const filtered = filterByDateRange(records, fromDate, toDate);
  const summary = callDropSummary(filtered);
  const grouped = filtered.reduce((acc, record) => {
    const key = toDateInputValue(record.startedAt);
    acc[key] ||= { date: key, total: 0, live: 0, attended: 0, droppedByAgent: 0, droppedByCustomer: 0 };
    acc[key].total += 1;
    if (record.status === "connecting" || record.status === "connected") acc[key].live += 1;
    if (record.status === "ended" && (record.transcript || []).length > 1) acc[key].attended += 1;
    if (record.status === "error") acc[key].droppedByAgent += 1;
    if (record.status === "ended" && (record.transcript || []).length <= 1) acc[key].droppedByCustomer += 1;
    return acc;
  }, {});
  return {
    summary,
    rows: Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function applyCallEvent(records, event) {
  if (!event?.sessionId) return records;
  const existing = records.find((record) => record.id === event.sessionId);
  const base = existing || {
    id: event.sessionId,
    startedAt: event.startedAt || nowIso(),
    endedAt: null,
    status: "connecting",
    channel: "Voice",
    source: "Phone widget",
    agentJoined: false,
    workflowStatus: "Open",
    transcript: [],
    summary: "Live EC Calling Agent call in progress.",
  };
  let updated = { ...base, transcript: [...(base.transcript || [])] };

  if (event.type === "call-created") {
    updated = { ...updated, status: "connecting", startedAt: event.startedAt || updated.startedAt, endedAt: null };
  }

  if (event.type === "call-start") {
    updated = { ...updated, status: "connected", agentJoined: true };
  }

  if (event.type === "call-end") {
    updated = { ...updated, status: "ended", endedAt: event.endedAt || nowIso(), summary: summarizeCall(updated) };
  }

  if (event.type === "call-error") {
    updated = { ...updated, status: "error", endedAt: event.endedAt || nowIso(), summary: event.message || "EC Calling Agent call failed." };
  }

  if (event.type === "transcript" && event.text?.trim()) {
    const nextEntry = {
      speaker: event.speaker || "Customer",
      text: event.text.trim(),
      at: event.at || nowIso(),
      final: event.final !== false,
      partial: Boolean(event.partial),
    };
    const lastEntry = updated.transcript[updated.transcript.length - 1];
    const shouldReplacePartial = lastEntry?.partial && lastEntry.speaker === nextEntry.speaker;
    const isDuplicate = lastEntry?.speaker === nextEntry.speaker && lastEntry?.text === nextEntry.text;
    if (shouldReplacePartial) {
      updated.transcript = [...updated.transcript.slice(0, -1), nextEntry];
    } else if (!isDuplicate) {
      updated.transcript = [...updated.transcript, nextEntry];
    }
    updated.summary = summarizeCall(updated);
    updated.lead = extractLeadDetails(updated);
  }

  const nextRecords = [updated, ...records.filter((record) => record.id !== event.sessionId)];
  return nextRecords.slice(0, MAX_CALL_RECORDS);
}

function extractTranscriptFromVapiMessage(message) {
  const type = String(message?.type || message?.message?.type || "").toLowerCase();
  const role = String(message?.role || message?.message?.role || message?.speaker || "").toLowerCase();
  const transcriptType = String(message?.transcriptType || message?.message?.transcriptType || "").toLowerCase();
  const text = message?.transcript || message?.text || message?.message?.content || message?.content;
  if (!text || (!type.includes("transcript") && !role)) return null;
  const speaker = role.includes("assistant") || role.includes("bot") || role.includes("agent") ? "AI Agent" : "Customer";
  return {
    speaker,
    text: String(text),
    final: transcriptType !== "partial",
    partial: transcriptType === "partial",
  };
}

function App() {
  const [activePage, setActivePage] = useState("overview");
  const [callRecords, setCallRecords] = useState(loadCallRecords);
  const [selectedConversationId, setSelectedConversationId] = useState(() => callRecords[0]?.id || "");
  const [callPanelOpen, setCallPanelOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [notificationCount, setNotificationCount] = useState(0);
  const [emailRecipientsText, setEmailRecipientsText] = useState(loadEmailRecipients);
  const [emailUpdates, setEmailUpdates] = useState(loadEmailUpdates);
  const emailRecipientsRef = useRef(parseEmailRecipients(emailRecipientsText));
  const autoEmailCallIdsRef = useRef(new Set([
    ...emailUpdates.map((update) => update.callId).filter((id) => id && id !== "digest"),
    ...answeredCallRecords(callRecords).map((record) => record.id),
  ]));
  const uaeClock = useUaeClock();
  const call = useVapiCall((event) => {
    setCallRecords((currentRecords) => applyCallEvent(currentRecords, event));
    if (event?.sessionId) setSelectedConversationId(event.sessionId);
    if (event?.type === "call-created") setNotificationCount((count) => count + 1);
    persistCallEvent(event);
  });
  const liveMetrics = useMemo(() => buildMetrics(callRecords), [callRecords]);
  const actionQueue = useMemo(() => buildActionQueue(callRecords), [callRecords]);
  const filteredActionQueue = useMemo(() => (
    actionQueue.filter(([priority, title, meta]) => matchesQuery([priority, title, meta], globalSearch))
  ), [actionQueue, globalSearch]);
  const callVolume = useMemo(() => buildCallVolume(callRecords), [callRecords]);
  const visibleRecords = useMemo(() => callRecords.slice(0, MAX_VISIBLE_CALLS), [callRecords]);
  const liveConversations = useMemo(() => visibleRecords.map(recordToConversation), [visibleRecords]);
  const liveLeads = useMemo(() => visibleRecords.map(recordToLead), [visibleRecords]);
  const reportConversations = useMemo(() => callRecords.map(recordToConversation), [callRecords]);
  const reportLeads = useMemo(() => callRecords.map(recordToLead), [callRecords]);
  const answeredCalls = useMemo(() => answeredCallRecords(callRecords), [callRecords]);
  const selectedConversation = liveConversations.find((item) => item.id === selectedConversationId) || liveConversations[0];
  const navItems = useMemo(() => NAV_ITEMS.map((item) => {
    if (item.id === "conversations") return { ...item, count: liveConversations.length };
    if (item.id === "leads") return { ...item, count: liveLeads.length };
    if (item.id === "email") return { ...item, count: emailUpdates.length || answeredCalls.length };
    return item;
  }), [answeredCalls.length, liveConversations.length, liveLeads.length, emailUpdates.length]);

  function updateWorkflowStatus(recordId, workflowStatus) {
    setCallRecords((currentRecords) => currentRecords.map((record) => (
      record.id === recordId ? { ...record, workflowStatus } : record
    )));
    persistWorkflowStatus(recordId, workflowStatus);
  }

  useEffect(() => {
    let active = true;

    async function refreshRecords() {
      try {
        const data = await fetchServerCallRecords();
        if (!active || data.persistence !== "supabase" || !Array.isArray(data.records)) return;
        setCallRecords(data.records);
        setSelectedConversationId((currentId) => (
          data.records.some((record) => record.id === currentId) ? currentId : data.records[0]?.id || ""
        ));
      } catch {
        // Local dashboard mode continues to use localStorage when no backend database is configured.
      }
    }

    refreshRecords();

    const realtimeClient = getDashboardSupabaseClient();
    if (!realtimeClient) {
      const timer = window.setInterval(refreshRecords, 5000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }

    const channel = realtimeClient
      .channel("ethikcorp-live-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, refreshRecords)
      .on("postgres_changes", { event: "*", schema: "public", table: "transcripts" }, refreshRecords)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, refreshRecords)
      .subscribe();

    return () => {
      active = false;
      realtimeClient.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CALL_HISTORY_KEY, JSON.stringify(callRecords));
  }, [callRecords]);

  useEffect(() => {
    const recipients = parseEmailRecipients(emailRecipientsText);
    emailRecipientsRef.current = recipients;
    window.localStorage.setItem(EMAIL_RECIPIENTS_KEY, JSON.stringify(recipients));
  }, [emailRecipientsText]);

  useEffect(() => {
    window.localStorage.setItem(EMAIL_UPDATES_KEY, JSON.stringify(emailUpdates.slice(0, 30)));
  }, [emailUpdates]);

  useEffect(() => {
    const recipients = emailRecipientsRef.current;
    if (!recipients.length) return;

    answeredCallRecords(callRecords).forEach((record) => {
      if (autoEmailCallIdsRef.current.has(record.id)) return;
      autoEmailCallIdsRef.current.add(record.id);

      const message = buildSingleEmailSummary(record);
      const update = buildEmailUpdateRecord({
        callId: record.id,
        recipients,
        message,
        status: "sending",
      });

      setEmailUpdates((currentUpdates) => [update, ...currentUpdates].slice(0, 30));
      sendEmailUpdate(recipients, "EthikCorp EC Calling Agent call summary", message)
        .then((result) => {
          setEmailUpdates((currentUpdates) => currentUpdates.map((item) => (
            item.id === update.id
              ? { ...item, status: result.configured === false ? "preview" : "sent", result, sentAt: nowIso() }
              : item
          )));
        })
        .catch((error) => {
          setEmailUpdates((currentUpdates) => currentUpdates.map((item) => (
            item.id === update.id
              ? { ...item, status: "error", error: error.message || "Could not send email update.", sentAt: nowIso() }
              : item
          )));
        });
    });
  }, [callRecords]);

  return (
    <div className={`app-shell page-${activePage}`}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} navItems={navItems} />
      <div className="main-shell">
        <Topbar
          activePage={activePage}
          setActivePage={setActivePage}
          openCall={() => setCallPanelOpen(true)}
          navItems={navItems}
          globalSearch={globalSearch}
          setGlobalSearch={setGlobalSearch}
          notificationCount={notificationCount}
          clearNotifications={() => setNotificationCount(0)}
        />
        <main className="page-canvas">
          {activePage === "overview" && <OverviewPage metrics={liveMetrics} actionQueue={filteredActionQueue} callVolume={callVolume} uaeClock={uaeClock} callRecords={callRecords} />}
          {activePage === "conversations" && (
            <ConversationsPage
              conversations={liveConversations}
              reportConversations={reportConversations}
              selectedConversation={selectedConversation}
              setSelectedConversationId={setSelectedConversationId}
              updateWorkflowStatus={updateWorkflowStatus}
              globalSearch={globalSearch}
            />
          )}
          {activePage === "leads" && <LeadsPage leads={liveLeads} reportLeads={reportLeads} updateWorkflowStatus={updateWorkflowStatus} globalSearch={globalSearch} />}
          {activePage === "email" && (
            <EmailUpdatesPage
              callRecords={callRecords}
              leads={reportLeads}
              globalSearch={globalSearch}
              recipientsText={emailRecipientsText}
              setRecipientsText={setEmailRecipientsText}
              emailUpdates={emailUpdates}
              setEmailUpdates={setEmailUpdates}
            />
          )}
          {activePage === "test" && <TestCallPage call={call} callRecords={callRecords} />}
        </main>
      </div>
      <FloatingCallWidget isOpen={callPanelOpen} setIsOpen={setCallPanelOpen} call={call} />
    </div>
  );
}

function useVapiCall(onCallEvent) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Ready for EC Calling Agent test.");
  const [participantCount, setParticipantCount] = useState(0);
  const [agentJoined, setAgentJoined] = useState(false);
  const [dispatchAccepted, setDispatchAccepted] = useState(false);
  const vapiRef = useRef(null);
  const audioRef = useRef(null);
  const activeCallIdRef = useRef(null);
  const onCallEventRef = useRef(onCallEvent);

  useEffect(() => {
    onCallEventRef.current = onCallEvent;
  }, [onCallEvent]);

  useEffect(() => {
    return () => {
      vapiRef.current?.stop?.();
    };
  }, []);

  function emitCallEvent(event) {
    onCallEventRef.current?.(event);
  }

  function getErrorMessage(error) {
    if (!error) return "Could not start the EC Calling Agent call.";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    return error.message || error.error?.message || error.error || "Could not start the EC Calling Agent call.";
  }

  async function getVapiClient() {
    if (vapiRef.current) return vapiRef.current;

    const module = await import("@vapi-ai/web");
    const Vapi = module.default?.default || module.default;
    const vapi = new Vapi(VAPI_PUBLIC_KEY);

    vapi.on("call-start", () => {
      setStatus("connected");
      setAgentJoined(true);
      setDispatchAccepted(true);
      setParticipantCount(2);
      setMessage("EC Calling Agent is live. Speak now.");
      emitCallEvent({ type: "call-start", sessionId: activeCallIdRef.current, startedAt: nowIso() });
    });

    vapi.on("call-end", () => {
      setStatus("idle");
      setAgentJoined(false);
      setDispatchAccepted(false);
      setParticipantCount(0);
      setMessage("Call disconnected. Ready for another test.");
      emitCallEvent({ type: "call-end", sessionId: activeCallIdRef.current, endedAt: nowIso() });
      activeCallIdRef.current = null;
    });

    vapi.on("speech-start", () => {
      setMessage("EC Calling Agent is speaking.");
    });

    vapi.on("speech-end", () => {
      setMessage("Listening. You can speak now.");
    });

    vapi.on("call-start-progress", (event) => {
      if (event?.stage) {
        setMessage("Connecting to EC Calling Agent...");
      }
    });

    vapi.on("call-start-failed", (event) => {
      setStatus("error");
      setAgentJoined(false);
      setDispatchAccepted(false);
      setParticipantCount(0);
      setMessage(event?.error || "The EC Calling Agent call could not start.");
      emitCallEvent({
        type: "call-error",
        sessionId: activeCallIdRef.current,
        endedAt: nowIso(),
        message: event?.error || "The EC Calling Agent call could not start.",
      });
    });

    vapi.on("error", (error) => {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      setAgentJoined(false);
      setDispatchAccepted(false);
      setParticipantCount(0);
      setMessage(errorMessage);
      emitCallEvent({ type: "call-error", sessionId: activeCallIdRef.current, endedAt: nowIso(), message: errorMessage });
    });

    vapi.on("message", (event) => {
      const transcript = extractTranscriptFromVapiMessage(event);
      if (!transcript || !activeCallIdRef.current) return;
      emitCallEvent({
        type: "transcript",
        sessionId: activeCallIdRef.current,
        at: nowIso(),
        ...transcript,
      });
    });

    vapiRef.current = vapi;
    return vapi;
  }

  async function startCall() {
    if (status === "connecting" || status === "connected") return;
    const sessionId = `ec-${Date.now()}`;
    activeCallIdRef.current = sessionId;
    setStatus("connecting");
    setMessage("Requesting microphone access...");
    setAgentJoined(false);
    setDispatchAccepted(false);
    setParticipantCount(0);
    emitCallEvent({ type: "call-created", sessionId, startedAt: nowIso() });

    try {
      const vapi = await getVapiClient();
      await vapi.start(VAPI_ASSISTANT_ID, EC_AGENT_ASSISTANT_OVERRIDES);
      setMessage("Connecting to EC Calling Agent...");
    } catch (error) {
      setStatus("error");
      setAgentJoined(false);
      setDispatchAccepted(false);
      setParticipantCount(0);
      setMessage(getErrorMessage(error));
      emitCallEvent({ type: "call-error", sessionId, endedAt: nowIso(), message: getErrorMessage(error) });
    }
  }

  function endCall() {
    const sessionId = activeCallIdRef.current;
    vapiRef.current?.stop?.();
    setStatus("idle");
    setMessage("Call disconnected. Ready for another test.");
    setParticipantCount(0);
    setAgentJoined(false);
    setDispatchAccepted(false);
    emitCallEvent({ type: "call-end", sessionId, endedAt: nowIso() });
    activeCallIdRef.current = null;
  }

  return { status, message, roomName: "", participantCount, agentJoined, dispatchAccepted, startCall, endCall, audioRef };
}

function Sidebar({ activePage, setActivePage, navItems }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/brand/ethikcorp-logo-blue.png" alt="EthikCorp" />
        <button type="button" aria-label="Collapse menu">
          <Grid2X2 size={18} />
        </button>
      </div>
      <nav className="side-nav" aria-label="Dashboard sections">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={activePage === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActivePage(item.id)}
            >
              <Icon size={20} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              {typeof item.count === "number" && item.count > 0 && <em>{item.count}</em>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">EC</span>
        <div>
          <strong>EthikCorp</strong>
          <small>EC Calling Agent</small>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ activePage, setActivePage, openCall, navItems, globalSearch, setGlobalSearch, notificationCount, clearNotifications }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const titles = {
    overview: ["Voice Agent Analytics at a glance", ""],
    conversations: ["Conversation", "Past calls and transcript review"],
    leads: ["Lead Management", "Client information captured by the AI agent"],
    email: ["Email Updates", "Send call summaries and captured lead details"],
    test: ["Diagnostics", "Live EC Calling Agent quality check"],
  };
  const [title, subtitle] = titles[activePage];

  useEffect(() => {
    setMenuOpen(false);
  }, [activePage]);

  return (
    <header className="topbar">
      <div className="mobile-topbar-brand">
        <button type="button" aria-label="Go to Home Page" onClick={() => setActivePage("overview")}>
          <img src="/brand/ethikcorp-logo-blue.png" alt="EthikCorp" />
        </button>
      </div>
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="mobile-topbar-controls">
        <button
          type="button"
          className="mobile-call-trigger"
          aria-label="Open EC Calling Agent test widget"
          onClick={() => {
            setMenuOpen(false);
            openCall();
          }}
        >
          <PhoneCall size={20} />
        </button>
        <div className="mobile-menu-wrap">
          <button
            type="button"
            className={menuOpen ? "mobile-menu-trigger open" : "mobile-menu-trigger"}
            aria-label="Open dashboard menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-dashboard-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Grid2X2 size={20} />
          </button>
          {menuOpen && (
            <nav id="mobile-dashboard-menu" className="mobile-menu-panel" aria-label="Mobile dashboard sections">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={activePage === item.id ? "active" : ""}
                    onClick={() => setActivePage(item.id)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                    {typeof item.count === "number" && item.count > 0 && <em>{item.count}</em>}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </div>
      <div className="topbar-actions">
        <label className="search-box">
          <Search size={18} />
          <input aria-label="Search live records" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} />
        </label>
        <span className="status-pill"><span /> AI Live</span>
        <span className="latency-pill"><Zap size={15} /> 308ms</span>
        <button
          type="button"
          className={notificationCount ? "notification-button has-alert" : "notification-button"}
          aria-label={notificationCount ? `${notificationCount} new call notification` : "No new notifications"}
          onClick={clearNotifications}
        >
          <Bell size={18} />
          {notificationCount > 0 && <em>{notificationCount}</em>}
        </button>
        <span className="avatar top">EC</span>
      </div>
    </header>
  );
}

function OverviewPage({ metrics: dashboardMetrics, actionQueue, callVolume, uaeClock, callRecords }) {
  const [reportFromDate, setReportFromDate] = useState("");
  const [reportToDate, setReportToDate] = useState("");

  function downloadDashboardReport() {
    const { summary, rows } = dailyCallRows(callRecords, reportFromDate, reportToDate);
    const reportRows = rows.map((row) => [
      row.date,
      row.total,
      row.live,
      row.attended,
      row.droppedByAgent,
      row.droppedByCustomer,
      "",
      "",
      "",
    ]);
    reportRows.push([
      "Period summary",
      "",
      "",
      summary.attended,
      summary.droppedByAgent,
      "",
      summary.total,
      summary.droppedByAgentPct,
      summary.attendedPct,
    ]);
    downloadCsv(
      buildReportFilename("ethikcorp-call-analytics", reportFromDate, reportToDate, "csv"),
      ["Date", "Total calls", "Live calls", "Calls attended", "Dropped by agent", "Dropped by customer", "Period total", "Dropped by agent %", "Calls attended %"],
      reportRows,
    );
  }

  return (
    <section className="dashboard-page">
      <div className="mobile-overview-heading">
        <h1>Voice agent Analytics</h1>
      </div>
      <div className="report-row">
        <p>Reporting window <strong>July 2026</strong> · UAE time zone</p>
        <div className="uae-clock" aria-label="Current UAE time">
          <span>UAE Time</span>
          <strong>{uaeClock.time}</strong>
          <small>{uaeClock.date}</small>
        </div>
      </div>
      <div className="metric-grid">
        {dashboardMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article className={`metric-card ${metric.tone}`} key={metric.label}>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.delta}</small>
              </div>
              <Icon size={24} />
            </article>
          );
        })}
      </div>
      <div className="overview-grid">
        <article className="panel large">
          <PanelTitle title="Call Volume" subtitle="Inbound AI agent calls over time" />
          <LineChart data={callVolume} />
        </article>
        <article className="panel action-queue">
          <PanelTitle title="Action Queue" subtitle="Items needing human follow-up" />
          {(actionQueue.length ? actionQueue : [["Medium", "No follow-up required", "Calls are up to date"]]).map(([priority, title, meta]) => (
            <div className="queue-item" key={title}>
              <span className={priority.toLowerCase()} />
              <div><strong>{title}</strong><small>{meta}</small></div>
              <em>{priority}</em>
            </div>
          ))}
        </article>
      </div>
      <ReportDownloadBar
        title="Download call analytics report"
        description="Daily live calls, attendance, agent drops, and period summary."
        fromDate={reportFromDate}
        setFromDate={setReportFromDate}
        toDate={reportToDate}
        setToDate={setReportToDate}
        buttonLabel="Download Report"
        onDownload={downloadDashboardReport}
      />
    </section>
  );
}

function PanelTitle({ title, subtitle }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function LineChart({ data }) {
  const maxValue = Math.max(1, ...data.map((point) => point.calls));
  const livePath = buildSvgPath(data, maxValue);
  return (
    <div className="chart-wrap" aria-label="Call volume chart">
      <svg viewBox="0 0 960 270" role="img">
        {[0, 1, 2, 3].map((n) => <line key={n} x1="0" x2="960" y1={55 + n * 58} y2={55 + n * 58} />)}
        <path className="area" d={`${livePath} L 920 270 L 0 270 Z`} />
        <path className="cyan-line" d={livePath} />
        {data.map((point, index) => {
          const x = data.length === 1 ? 0 : Math.round(index * (920 / (data.length - 1)));
          const y = Math.round(224 - (point.calls / maxValue) * 180);
          return <circle key={point.label} cx={x} cy={y} r="5" />;
        })}
      </svg>
      <div className="chart-days">{data.map((point) => <span key={point.label}>{point.label}</span>)}</div>
    </div>
  );
}

function FunnelList() {
  const items = [
    ["Calls received", "186", "100%", "#25A9DA"],
    ["AI answered", "178", "95.6%", "#325A9F"],
    ["Lead captured", "62", "33.3%", "#20B486"],
    ["Human follow-up", "18", "9.7%", "#8B5CF6"],
    ["Dropped by AI", "11", "5.9%", "#F59E0B"],
    ["Dropped by customer", "39", "21.0%", "#EF4444"],
  ];
  return (
    <div className="funnel-list">
      {items.map(([label, value, pct, color]) => (
        <div key={label}>
          <span><strong>{label}</strong><em>{value} ({pct})</em></span>
          <i><b style={{ width: pct, background: color }} /></i>
        </div>
      ))}
    </div>
  );
}

function BarMix() {
  const items = [
    ["Website", 88, "#25A9DA"],
    ["Direct", 64, "#325A9F"],
    ["Email", 42, "#21B486"],
    ["Campaigns", 31, "#F59E0B"],
    ["Referral", 24, "#8B5CF6"],
  ];
  return (
    <div className="bar-mix">
      {items.map(([label, value, color]) => (
        <div key={label}>
          <b style={{ height: `${value}%`, background: color }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function formatDateControlLabel(value) {
  if (!value) return "Any date";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-AE", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function DateInputBox({ label, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => (value ? new Date(`${value}T12:00:00`) : new Date()));
  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const selectedMonth = monthKey(visibleMonth);

  function selectDate(date) {
    onChange(toLocalDateInputValue(date));
    setVisibleMonth(date);
    setIsOpen(false);
  }

  function shiftMonth(offset) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return (
    <div className={isOpen ? "modern-date-field open" : "modern-date-field"}>
      <span>{label}</span>
      <button type="button" className="date-trigger" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        <CalendarDays size={16} />
        <em>{formatDateControlLabel(value)}</em>
      </button>
      {isOpen && (
        <div className="mini-calendar" role="dialog" aria-label={`${label} calendar`}>
          <header>
            <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
            <strong>{visibleMonth.toLocaleDateString("en-AE", { month: "long", year: "numeric" })}</strong>
            <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
          </header>
          <div className="calendar-weekdays">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="calendar-days">
            {days.map((date) => {
              const dateValue = toLocalDateInputValue(date);
              return (
                <button
                  type="button"
                  key={dateValue}
                  className={[
                    monthKey(date) !== selectedMonth ? "muted" : "",
                    value === dateValue ? "selected" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => selectDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportDownloadBar({ title, description, fromDate, setFromDate, toDate, setToDate, buttonLabel, onDownload, showDates = true }) {
  return (
    <div className={showDates ? "download-report-bar with-dates" : "download-report-bar button-only"}>
      <div>
        <FileText size={18} />
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </div>
      {showDates && (
        <>
          <DateInputBox label="Start date" value={fromDate} onChange={setFromDate} />
          <DateInputBox label="End date" value={toDate} onChange={setToDate} />
        </>
      )}
      <button type="button" onClick={onDownload}>
        <Download size={17} />
        {buttonLabel}
      </button>
    </div>
  );
}

function DateStatusFilters({ fromDate, setFromDate, toDate, setToDate, statusFilter, setStatusFilter }) {
  return (
    <div className="data-filter-row">
      <DateInputBox label="Start date" value={fromDate} onChange={setFromDate} />
      <DateInputBox label="End date" value={toDate} onChange={setToDate} />
      <StatusDropdown
        label="Status"
        value={statusFilter}
        options={["All", ...WORKFLOW_STATUSES]}
        onChange={setStatusFilter}
      />
    </div>
  );
}

function StatusFilter({ statusFilter, setStatusFilter }) {
  return (
    <div className="status-filter-row">
      <StatusDropdown
        label="Status"
        value={statusFilter}
        options={["All", ...WORKFLOW_STATUSES]}
        onChange={setStatusFilter}
      />
    </div>
  );
}

function WorkflowStatusSelect({ value, onChange, label = "Status", showLabel = true }) {
  return (
    <StatusDropdown
      label={label}
      value={value}
      options={WORKFLOW_STATUSES}
      onChange={onChange}
      showLabel={showLabel}
      className={`workflow-select ${workflowStatusClass(value)} ${showLabel ? "" : "compact"}`}
    />
  );
}

function StatusDropdown({ label, value, options, onChange, showLabel = true, className = "" }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={`status-dropdown ${className} ${isOpen ? "open-menu" : ""}`}>
      {showLabel && <span>{label}</span>}
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        <strong>{value}</strong>
        <ChevronDown size={15} />
      </button>
      {isOpen && (
        <div className="status-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option === value}
              key={option}
              className={option === value ? "selected" : ""}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationsPage({ conversations, reportConversations, selectedConversation, setSelectedConversationId, updateWorkflowStatus, globalSearch }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortDirection, setSortDirection] = useState("desc");
  const [noteDraft, setNoteDraft] = useState("");
  const filteredConversations = useMemo(() => sortByDate(
    conversations.filter((item) => (
      withinDateFilter(item.dateValue, fromDate, toDate)
      && (statusFilter === "All" || item.status === statusFilter)
      && matchesQuery([
        item.name,
        item.company,
        item.phone,
        item.date,
        item.status,
        item.summary,
        ...item.transcript.flatMap(([speaker, text]) => [speaker, text]),
      ], globalSearch)
    )),
    sortDirection,
  ), [conversations, fromDate, toDate, statusFilter, sortDirection, globalSearch]);
  const activeConversation = selectedConversation && filteredConversations.some((item) => item.id === selectedConversation.id)
    ? selectedConversation
    : filteredConversations[0];

  useEffect(() => {
    setNoteDraft("");
  }, [activeConversation?.id]);

  function downloadConversationReport() {
    const rows = filterByDateRange(reportConversations, fromDate, toDate).map((item) => [
      item.date,
      item.name,
      item.phone,
      item.company,
      item.status,
      item.summary,
      item.transcript.map(([speaker, text, time]) => `${time} ${speaker}: ${text}`).join(" | "),
    ]);
    downloadCsv(
      buildReportFilename("ethikcorp-conversations", fromDate, toDate, "csv"),
      ["Date", "Customer", "Phone", "Place", "Status", "Summary", "Transcript"],
      rows,
    );
  }

  return (
    <section className="conversation-layout">
      <aside className="conversation-list">
        <DateStatusFilters
          fromDate={fromDate}
          setFromDate={setFromDate}
          toDate={toDate}
          setToDate={setToDate}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />
        <div className="conversation-report-action">
          <button type="button" onClick={downloadConversationReport}>
            <Download size={17} />
            Download Report
          </button>
        </div>
        {!!filteredConversations.length && (
          <div className="conversation-list-head">
            <span>Customer</span>
            <button type="button" className="table-sort" onClick={() => setSortDirection((direction) => (direction === "desc" ? "asc" : "desc"))}>
              Date {sortDirection === "desc" ? "↓" : "↑"}
            </button>
            <span>Status</span>
          </div>
        )}
        {!filteredConversations.length && (
          <div className="empty-state compact">
            <strong>No live call data yet</strong>
            <p>New calls made from the phone widget will appear here when they match the filters.</p>
          </div>
        )}
        {filteredConversations.map((item) => (
          <button
            type="button"
            className={activeConversation?.id === item.id ? "conversation-card active" : "conversation-card"}
            key={item.id}
            onClick={() => setSelectedConversationId(item.id)}
          >
            <span><strong>{item.name}</strong><em>{item.time}</em></span>
            <b>{item.date}</b>
            <small>{item.status}</small>
            <p>{item.summary}</p>
          </button>
        ))}
      </aside>
      <article className="transcript-panel">
        {activeConversation ? (
          <>
            <header>
              <div>
                <h2>{activeConversation.name} - Customer Journey</h2>
                <p>{activeConversation.company} · {activeConversation.phone} · {activeConversation.date}</p>
              </div>
              <WorkflowStatusSelect
                value={activeConversation.status}
                onChange={(status) => updateWorkflowStatus(activeConversation.id, status)}
              />
            </header>
            <div className="transcript-stream">
              {activeConversation.transcript.map(([speaker, text, time], index) => (
                <div className="transcript-line" key={`${speaker}-${index}`}>
                  <span className={speaker === "AI Agent" ? "ai" : "customer"}>{speaker === "AI Agent" ? <Bot size={18} /> : <UserRound size={18} />}</span>
                  <div>
                    <strong>{speaker}<em>{time || `${index + 1} min`}</em></strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="reply-bar">
              <input
                placeholder="Internal note or follow-up message..."
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <button type="button" disabled={!noteDraft.trim()} onClick={() => setNoteDraft("")}>Save Note</button>
            </footer>
          </>
        ) : (
          <div className="empty-state transcript-empty">
            <strong>No transcript selected</strong>
            <p>Start a call from the phone widget. The latest transcript will show here automatically.</p>
          </div>
        )}
      </article>
    </section>
  );
}

function LeadsPage({ leads, reportLeads, updateWorkflowStatus, globalSearch }) {
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || "");
  const [leadSearch, setLeadSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortDirection, setSortDirection] = useState("desc");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const combinedSearch = [globalSearch, leadSearch].filter(Boolean).join(" ");
  const filteredLeads = useMemo(() => sortByDate(
    leads.filter((lead) => (
      statusFilter === "All" || lead.status === statusFilter
    )).filter((lead) => (
      withinDateFilter(lead.dateValue, fromDate, toDate)
    )).filter((lead) => (
      matchesQuery([
        lead.name,
        lead.place,
        lead.phone,
        lead.email,
        lead.requirement,
        lead.status,
        lead.date,
      ], combinedSearch)
    )),
    sortDirection,
  ), [leads, statusFilter, fromDate, toDate, sortDirection, combinedSearch]);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || leads[0];
  const openCount = leads.filter((lead) => lead.status === "Open").length;
  const followUpCount = leads.filter((lead) => lead.status === "Follow up required").length;
  const closedCount = leads.filter((lead) => lead.status === "Closed").length;

  useEffect(() => {
    if (!leads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(leads[0]?.id || "");
    }
  }, [leads, selectedLeadId]);

  function downloadLeadReport() {
    const rows = filterByDateRange(reportLeads, fromDate, toDate).filter((lead) => (
      statusFilter === "All" || lead.status === statusFilter
    )).map((lead) => [
      lead.date,
      lead.name,
      lead.place,
      lead.phone,
      lead.email,
      lead.requirement,
      lead.status,
      lead.score,
    ]);
    downloadExcelTable(
      buildReportFilename("ethikcorp-leads", fromDate, toDate, "xls"),
      "EthikCorp Leads Captured",
      ["Date", "Name", "Place", "Calling Number", "Email", "Customer Requirement", "Status", "Score"],
      rows,
    );
  }

  return (
    <section className="leads-page">
      <div className="lead-toolbar">
        <label className="lead-search"><Search size={17} /><input aria-label="Search leads" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} /></label>
        <StatusFilter
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />
        <DateInputBox label="Start date" value={fromDate} onChange={setFromDate} />
        <DateInputBox label="End date" value={toDate} onChange={setToDate} />
        <button type="button" className="download-inline-button" onClick={downloadLeadReport}>
          <Download size={17} />
          Download Report
        </button>
      </div>
      <div className="lead-summary">
        <span><strong>{filteredLeads.length}</strong> Showing</span>
        <span><strong>{openCount}</strong> Open</span>
        <span><strong>{followUpCount}</strong> Follow up</span>
        <span><strong>{closedCount}</strong> Closed</span>
      </div>
      <div className="mobile-lead-workspace">
        <div className="mobile-lead-list" aria-label="Captured leads">
          {!filteredLeads.length && (
            <div className="empty-state compact">
              <strong>No live leads yet</strong>
              <p>Caller details extracted from the latest calls will appear here when they match the filters.</p>
            </div>
          )}
          {filteredLeads.map((lead, index) => (
            <button
              type="button"
              className={selectedLead?.id === lead.id ? "mobile-lead-row active" : "mobile-lead-row"}
              key={lead.id || `${lead.phone}-${index}`}
              onClick={() => setSelectedLeadId(lead.id)}
            >
              <span>
                <strong>{lead.name}</strong>
                <small>{lead.phone}</small>
                <em>{lead.status}</em>
              </span>
            </button>
          ))}
        </div>
        {selectedLead ? (
          <article className="mobile-lead-detail">
            <header>
              <strong>{selectedLead.name}</strong>
              <WorkflowStatusSelect
                value={selectedLead.status}
                onChange={(status) => updateWorkflowStatus(selectedLead.id, status)}
                label="Lead status"
              />
            </header>
            <dl>
              <div><dt>Place</dt><dd>{selectedLead.place}</dd></div>
              <div><dt>Date</dt><dd>{selectedLead.date}</dd></div>
              <div><dt>Calling Number</dt><dd>{selectedLead.phone}</dd></div>
              <div><dt>Email</dt><dd>{selectedLead.email}</dd></div>
              <div><dt>Requirement</dt><dd>{selectedLead.requirement}</dd></div>
              <div><dt>Score</dt><dd>{selectedLead.score}</dd></div>
            </dl>
          </article>
        ) : (
          <article className="mobile-lead-detail empty-state">
            <strong>No lead selected</strong>
            <p>Make a live test call to capture the first lead.</p>
          </article>
        )}
      </div>
      <div className="table-panel">
        {filteredLeads.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>
                  <button type="button" className="table-sort" onClick={() => setSortDirection((direction) => (direction === "desc" ? "asc" : "desc"))}>
                    Date {sortDirection === "desc" ? "↓" : "↑"}
                  </button>
                </th>
                <th>Place</th>
                <th>Calling Number</th>
                <th>Email</th>
                <th>Customer Requirement</th>
                <th>Status</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead, index) => (
                <tr key={lead.id || `${lead.phone}-${index}`}>
                  <td><strong>{lead.name}</strong><small>{lead.source}</small></td>
                  <td>{lead.date}</td>
                  <td>{lead.place}</td>
                  <td>{lead.phone}</td>
                  <td>{lead.email}</td>
                  <td>{lead.requirement}</td>
                  <td>
                    <WorkflowStatusSelect
                      value={lead.status}
                      onChange={(status) => updateWorkflowStatus(lead.id, status)}
                      showLabel={false}
                    />
                  </td>
                  <td><Score value={lead.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state table-empty">
            <strong>No lead records yet</strong>
            <p>Only live call data is shown. New caller details will be saved here after the phone widget receives calls.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Score({ value }) {
  return <span className="score"><i><b style={{ width: `${value}%` }} /></i><strong>{value}</strong></span>;
}

function EmailUpdatesPage({ callRecords, leads, globalSearch, recipientsText, setRecipientsText, emailUpdates, setEmailUpdates }) {
  const [selectedCallId, setSelectedCallId] = useState("digest");
  const [sendState, setSendState] = useState({ status: "idle", message: "" });
  const answered = useMemo(() => answeredCallRecords(callRecords), [callRecords]);
  const filteredAnswered = useMemo(() => (
    answered.filter((record) => {
      const lead = extractLeadDetails(record);
      return matchesQuery([lead.name, lead.phone, lead.email, lead.place, lead.requirement, record.summary], globalSearch);
    })
  ), [answered, globalSearch]);
  const selectedRecord = answered.find((record) => record.id === selectedCallId);
  const recipients = useMemo(() => parseEmailRecipients(recipientsText), [recipientsText]);
  const messagePreview = useMemo(() => (
    selectedCallId === "digest"
      ? buildDigestEmailSummary(callRecords, leads)
      : buildSingleEmailSummary(selectedRecord)
  ), [callRecords, leads, selectedCallId, selectedRecord]);

  async function handleSendUpdate() {
    if (!recipients.length) {
      setSendState({ status: "error", message: "Add at least one valid email recipient." });
      return;
    }

    const update = buildEmailUpdateRecord({
      callId: selectedCallId,
      recipients,
      message: messagePreview,
      status: "sending",
    });
    setEmailUpdates((currentUpdates) => [update, ...currentUpdates].slice(0, 30));
    setSendState({ status: "sending", message: "Sending email update..." });
    try {
      const result = await sendEmailUpdate(recipients, "EthikCorp EC Calling Agent call summary", messagePreview);
      const status = result.configured === false ? "preview" : "sent";
      setEmailUpdates((currentUpdates) => currentUpdates.map((item) => (
        item.id === update.id ? { ...item, status, result, sentAt: nowIso() } : item
      )));
      if (result.configured === false) {
        setSendState({
          status: "warning",
          message: "Message preview is ready. Add SMTP credentials on the server to send externally.",
        });
        return;
      }

      setSendState({ status: "success", message: `Sent to ${result.sent || recipients.length} recipient${(result.sent || recipients.length) === 1 ? "" : "s"}.` });
    } catch (error) {
      setEmailUpdates((currentUpdates) => currentUpdates.map((item) => (
        item.id === update.id
          ? { ...item, status: "error", error: error.message || "Could not send email update.", sentAt: nowIso() }
          : item
      )));
      setSendState({ status: "error", message: error.message || "Could not send email update." });
    }
  }

  return (
    <section className="email-page">
      <div className="email-grid">
        <article className="panel email-composer">
          <PanelTitle title="Email Update" subtitle="Send answered call summaries with captured lead details." />
          <label className="email-recipients">
            <span>Recipient emails</span>
            <textarea
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
              placeholder={"operations@ethikcorp.com\nsales@ethikcorp.com"}
              rows={4}
            />
            <small>Use one email per line or separate addresses with commas.</small>
          </label>
          <div className="email-mode-row">
            <button
              type="button"
              className={selectedCallId === "digest" ? "active" : ""}
              onClick={() => setSelectedCallId("digest")}
            >
              Full lead digest
            </button>
            <span>{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span>
          </div>
          <div className="email-preview">
            <header>
              <strong>Message preview</strong>
              <small>{messagePreview.length} chars</small>
            </header>
            <pre>{messagePreview}</pre>
          </div>
          <button
            type="button"
            className="email-send-button"
            disabled={sendState.status === "sending"}
            onClick={handleSendUpdate}
          >
            <Send size={17} />
            {sendState.status === "sending" ? "Sending..." : "Send Email Update"}
          </button>
          {sendState.message && <p className={`email-send-status ${sendState.status}`}>{sendState.message}</p>}
        </article>

        <aside className="email-live-panel">
          <section className="email-update-feed">
            <header>
              <div>
                <strong>Live email updates</strong>
                <small>{emailUpdates.length} outgoing update{emailUpdates.length === 1 ? "" : "s"}</small>
              </div>
            </header>
            {!emailUpdates.length && (
              <div className="empty-state compact">
                <strong>No updates sent yet</strong>
                <p>After an answered call ends, the generated summary will appear here automatically.</p>
              </div>
            )}
            {emailUpdates.map((update) => (
              <article className={`email-update-card ${update.status}`} key={update.id}>
                <span>
                  <strong>{update.status === "preview" ? "Preview ready" : update.status === "sent" ? "Sent" : update.status === "error" ? "Failed" : "Sending"}</strong>
                  <em>{formatRelativeTime(update.sentAt)}</em>
                </span>
                <small>{update.recipients.join(", ")}</small>
                <p>{update.message}</p>
                {update.error && <b>{update.error}</b>}
              </article>
            ))}
          </section>

          <section className="email-call-list">
          <header>
            <div>
              <strong>Answered calls</strong>
              <small>{answered.length} call{answered.length === 1 ? "" : "s"} ready for summary</small>
            </div>
          </header>
          {!filteredAnswered.length && (
            <div className="empty-state compact">
              <strong>No answered calls yet</strong>
              <p>Completed calls with transcripts will appear here for email updates.</p>
            </div>
          )}
          {filteredAnswered.map((record) => {
            const lead = extractLeadDetails(record);
            return (
              <button
                type="button"
                key={record.id}
                className={selectedCallId === record.id ? "email-call-card active" : "email-call-card"}
                onClick={() => setSelectedCallId(record.id)}
              >
                <span>
                  <strong>{lead.name}</strong>
                  <em>{formatDisplayDate(record.startedAt)}</em>
                </span>
                <p>{lead.requirement}</p>
                <small>{lead.phone} · {lead.place}</small>
              </button>
            );
          })}
          </section>
        </aside>
      </div>
    </section>
  );
}

function TestCallPage({ call, callRecords }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [vapiUpdate, setVapiUpdate] = useState(null);
  const [vapiUpdateStatus, setVapiUpdateStatus] = useState({ state: "idle", message: "" });

  function downloadAgentLogs() {
    const rows = filterByDateRange(callRecords, fromDate, toDate).map((record) => {
      const lead = extractLeadDetails(record);
      const transcript = (record.transcript || [])
        .map(normalizeTranscriptEntry)
        .map((entry) => `${formatTranscriptTime(entry.at, 0)} ${entry.speaker}: ${entry.text}`)
        .join(" | ");
      return [
        formatDisplayDate(record.startedAt),
        record.startedAt,
        record.endedAt || "",
        record.status,
        getWorkflowStatus(record),
        lead.name,
        lead.phone,
        record.summary || summarizeCall(record),
        transcript,
      ];
    });
    downloadCsv(
      buildReportFilename("ethikcorp-agent-logs", fromDate, toDate, "csv"),
      ["Date", "Started at", "Ended at", "Call status", "Workflow status", "Customer", "Phone", "Summary", "Transcript log"],
      rows,
    );
  }

  async function loadLatestVapiUpdate() {
    setVapiUpdateStatus({ state: "loading", message: "Fetching latest Vapi agent update..." });
    try {
      const data = await fetchLatestVapiUpdate();
      setVapiUpdate(data);
      setVapiUpdateStatus({
        state: data.configured === false ? "warning" : "success",
        message: data.configured === false
          ? data.message
          : `Latest Vapi update fetched at ${formatTranscriptTime(data.fetchedAt, 0)}.`,
      });
    } catch (error) {
      setVapiUpdateStatus({ state: "error", message: error.message || "Could not fetch latest Vapi update." });
    }
  }

  return (
    <section className="test-call-page">
      <div className="diagnostics-left">
        <article className="panel test-copy">
          <PanelTitle
            title="Test Console"
            subtitle="Click the Start Call button to initiate a live call. Your browser will request permission to access the microphone before the call begins."
          />
        </article>
        <VapiLatestUpdateBox
          update={vapiUpdate}
          status={vapiUpdateStatus}
          onRefresh={loadLatestVapiUpdate}
        />
        <AgentLogDownloadBox
          fromDate={fromDate}
          setFromDate={setFromDate}
          toDate={toDate}
          setToDate={setToDate}
          onDownload={downloadAgentLogs}
        />
      </div>
      <PhoneMockup call={call} />
    </section>
  );
}

function VapiLatestUpdateBox({ update, status, onRefresh }) {
  const latestCall = update?.latestCalls?.[0];
  return (
    <article className="vapi-update-box">
      <header>
        <Bot size={18} />
        <div>
          <strong>Latest Vapi agent update</strong>
          <small>{update?.assistant?.name || "EC Calling Agent"}</small>
        </div>
      </header>
      <div className="vapi-update-grid">
        <span><small>Assistant ID</small><strong>{update?.assistant?.id || update?.assistantId || VAPI_ASSISTANT_ID}</strong></span>
        <span><small>Model</small><strong>{update?.assistant?.model || "Not fetched"}</strong></span>
        <span><small>Latest call</small><strong>{latestCall?.status || "No call data"}</strong></span>
        <span><small>Updated</small><strong>{update?.assistant?.updatedAt ? formatDisplayDate(update.assistant.updatedAt) : "Not fetched"}</strong></span>
      </div>
      {latestCall?.summary && (
        <p>{latestCall.summary}</p>
      )}
      {status.message && <p className={`vapi-update-status ${status.state}`}>{status.message}</p>}
      <button type="button" onClick={onRefresh} disabled={status.state === "loading"}>
        <Download size={17} />
        {status.state === "loading" ? "Fetching..." : "Get Latest Vapi Update"}
      </button>
    </article>
  );
}

function AgentLogDownloadBox({ fromDate, setFromDate, toDate, setToDate, onDownload }) {
  return (
    <article className="agent-log-box">
      <header>
        <FileText size={18} />
        <strong>Download logs</strong>
      </header>
      <p>Download agent logs for the below selected dates.</p>
      <div className="agent-log-dates">
        <DateInputBox label="Start date" value={fromDate} onChange={setFromDate} />
        <DateInputBox label="End date" value={toDate} onChange={setToDate} />
      </div>
      <button type="button" onClick={onDownload}>
        <Download size={17} />
        Download Logs
      </button>
    </article>
  );
}

function PhoneMockup({ call }) {
  const connected = call.status === "connected";
  const connecting = call.status === "connecting";
  const waitingForAgent = connected && !call.agentJoined;
  return (
    <article className="phone-mock">
      <div className="phone-speaker" />
      <div className="phone-screen">
        <header>
          <span>EC Calling Agent</span>
          <small>{call.agentJoined ? "Agent live" : waitingForAgent ? "Waiting for agent" : connecting ? "Connecting" : "Ready to test"}</small>
        </header>
        <div className={`pulse-orb ${call.agentJoined ? "connected" : ""}`}>
          {connected ? <Mic size={48} /> : <Phone size={48} />}
        </div>
        <div className="call-readout">
          <strong>{call.agentJoined ? "EC agent answered" : waitingForAgent ? "Room live, awaiting agent" : connecting ? "Starting secure room" : "Tap call to start"}</strong>
          <p>{call.message}</p>
          {call.roomName && <small>Room: {call.roomName}</small>}
          {connected && <small>Participants: {call.participantCount}</small>}
          {connected && <small>Dispatch: {call.dispatchAccepted ? "accepted by worker" : "waiting for worker"}</small>}
        </div>
        <div ref={call.audioRef} className="remote-audio" aria-live="polite" />
        <div className="phone-actions">
          <button type="button" className="call-start" disabled={connecting || connected} onClick={call.startCall}>
            <PhoneCall size={22} />
            Start Call
          </button>
          <button type="button" className="call-end" disabled={!connected && !connecting} onClick={call.endCall}>
            <PhoneOff size={22} />
            Disconnect
          </button>
        </div>
      </div>
    </article>
  );
}

function FloatingCallWidget({ isOpen, setIsOpen, call }) {
  const connecting = call.status === "connecting";
  const connected = call.status === "connected";

  return (
    <>
      <button className="floating-call" type="button" aria-label="Open live test call" onClick={() => setIsOpen(true)}>
        <PhoneForwarded size={27} />
      </button>
      {isOpen && (
        <div className="call-modal-backdrop" role="dialog" aria-modal="true" aria-label="Live test call popup">
          <div className="call-modal call-widget-phone" aria-label="EC Calling Agent test phone">
            <button className="modal-close" type="button" aria-label="Close popup" onClick={() => setIsOpen(false)}><X size={20} /></button>
            <div className="call-widget-speaker" />
            <div className="call-widget-screen">
              <header>
                <span>EC Calling Agent</span>
                <small>Ready to test</small>
              </header>
              <div className="call-widget-orb">
                <Phone size={34} />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={call.startCall} disabled={connecting || connected}>
                  <PhoneCall size={18} /> Start Call
                </button>
                <button type="button" className="secondary" onClick={call.endCall} disabled={!connected && !connecting}>
                  <MicOff size={18} /> Disconnect
                </button>
              </div>
            </div>
            <div ref={call.audioRef} className="remote-audio" />
          </div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
