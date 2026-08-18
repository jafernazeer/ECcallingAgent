import { useCallback, useEffect, useState } from "react";

/**
 * Reads live Retell data through the server proxy. The Retell secret key stays
 * server-side; the browser only ever sees these endpoints.
 */
export function useRetellData() {
  const [calls, setCalls] = useState([]);
  const [leads, setLeads] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selectedCall, setSelectedCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [callsResponse, analyticsResponse, leadsResponse] = await Promise.all([
        fetch("/api/retell/calls").then((r) => r.json()),
        fetch("/api/retell/analytics").then((r) => r.json()),
        fetch("/api/retell/leads").then((r) => r.json()),
      ]);
      if (leadsResponse?.ok) setLeads(leadsResponse.leads || []);
      if (callsResponse?.ok) setCalls(callsResponse.calls || []);
      else setError(callsResponse?.error || "Could not load call history.");
      if (analyticsResponse?.ok) setAnalytics(analyticsResponse);
    } catch {
      setError("Live data is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount, as the portal page opens.
  useEffect(() => { refresh(); }, [refresh]);

  const openCall = useCallback(async (callId) => {
    if (!callId) return;
    setSelectedCall({ callId, loading: true, transcript: [] });
    try {
      const result = await fetch(`/api/retell/calls/${encodeURIComponent(callId)}`).then((r) => r.json());
      setSelectedCall(result?.ok ? { ...result.call, loading: false } : { callId, loading: false, transcript: [], error: true });
    } catch {
      setSelectedCall({ callId, loading: false, transcript: [], error: true });
    }
  }, []);

  return { calls, leads, analytics, selectedCall, loading, error, refresh, openCall };
}

export function formatClock(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const s = String(Math.floor((seconds || 0) % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

export function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Best-effort caller name from Retell's summary line. Display only. */
export function callerNameFromSummary(summary) {
  const match = /Name:\s*([^;.\n]+)/i.exec(String(summary || ""));
  const name = match?.[1]?.trim();
  return name && name.length < 40 ? name : "";
}
