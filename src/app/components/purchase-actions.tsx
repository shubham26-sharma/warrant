"use client";

import { useState } from "react";

export function PurchaseActions({ decisionId, mandateId, verdict, approved, orderStatus }: { decisionId: string; mandateId: string; verdict: "APPROVE" | "REVIEW" | "BLOCK"; approved: boolean; orderStatus?: string }) {
  const [note, setNote] = useState("");
  const [hasApproval, setHasApproval] = useState(approved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchases/${decisionId}/approve-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Approval failed");
      setHasApproval(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Approval failed"); }
    finally { setBusy(false); }
  }

  async function checkout() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchases/${decisionId}/checkout`, { method: "POST" });
      const value = await response.json() as { approvalUrl?: string; error?: string };
      if (!response.ok || !value.approvalUrl) throw new Error(value.error ?? "Checkout could not start");
      window.location.assign(value.approvalUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Checkout could not start"); }
    finally { setBusy(false); }
  }

  if (verdict === "BLOCK") return <div className="notice notice-error"><strong>Blocked by hard rule.</strong><p>This cart cannot be overridden. Edit the mandate to create a new version.</p><a className="text-link" href={`/mandates/new?edit=${mandateId}`}>Edit this mandate →</a></div>;
  if (orderStatus === "COMPLETED") return <div className="notice notice-good">PayPal capture completed. See the <a className="text-link" href="/audit">audit trail</a>.</div>;

  return <div className="stack-md">
    {verdict === "REVIEW" && !hasApproval && <div className="stack-sm">
      <label><span className="field-label">Approve this REVIEW with a note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} required minLength={1} maxLength={1000} rows={3} placeholder="Explain what you checked" /></label>
      <button className="button button-secondary" type="button" disabled={busy || !note.trim()} onClick={approve}>{busy ? "Saving…" : "Approve anyway"}</button>
    </div>}
    {(verdict === "APPROVE" || hasApproval) && <button className="button button-primary" type="button" disabled={busy} onClick={checkout}>{busy ? "Opening PayPal…" : "Pay with PayPal (Sandbox)"}</button>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
