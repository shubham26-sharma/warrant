"use client";

import { useMemo, useState } from "react";

type EventRow = { id: number; type: string; payload: unknown; prevHash: string; hash: string; createdAt: string };

export function AuditTable({ events }: { events: EventRow[] }) {
  const [filter, setFilter] = useState("");
  const [verification, setVerification] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => events.filter((event) => `${event.id} ${event.type} ${JSON.stringify(event.payload)} ${event.hash}`.toLowerCase().includes(filter.toLowerCase())), [events, filter]);

  async function verify() {
    setBusy(true); setVerification("");
    try {
      const response = await fetch("/api/audit/verify", { method: "POST" });
      const result = await response.json() as { ok: boolean; brokenAtId?: number; error?: string };
      setVerification(result.ok ? "Chain verified: all stored events link correctly." : result.brokenAtId ? `Chain check failed at event ${result.brokenAtId}.` : result.error ?? "Chain verification failed.");
    } catch { setVerification("Could not verify the audit chain."); }
    finally { setBusy(false); }
  }

  return <div className="stack-md">
    <div className="row-wrap"><label className="filter-label">Filter audit events<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Type, id, payload, hash" /></label><button className="button button-secondary" type="button" onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify chain"}</button></div>
    {verification && <p className={verification.startsWith("Chain verified") ? "notice notice-good" : "notice notice-error"} role="status">{verification}</p>}
    {!rows.length ? <div className="empty-state"><h2>No audit events</h2><p>Events appear here when a mandate, proposal, approval, or checkout changes state.</p></div> :
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Type</th><th>Mandate version</th><th>Cart hash</th><th>Verdict</th><th>PayPal ids</th><th>Hash</th><th>Details</th></tr></thead><tbody>
        {rows.map((event) => {
          const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
          return <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td><strong>{event.type}</strong></td><td>{String(payload.mandateVersion ?? "—")}</td><td><code>{typeof payload.cartHash === "string" ? `${payload.cartHash.slice(0, 12)}…` : "—"}</code></td><td>{String(payload.verdict ?? "—")}</td><td><code>{String(payload.orderId ?? payload.captureId ?? "—")}</code></td><td><code>{event.hash.slice(0, 12)}…</code></td><td><details><summary>View canonical payload</summary><pre className="payload">{JSON.stringify(event.payload, null, 2)}</pre></details></td></tr>;
        })}
      </tbody></table></div>}
    <p className="small-muted">This is a tamper-evident application audit trail, not a legal signature.</p>
  </div>;
}
