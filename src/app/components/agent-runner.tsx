"use client";

import { useState } from "react";
import type { Mandate } from "@/lib/schemas/mandate";
import { formatUsd } from "@/lib/money";
import { StatusBadge } from "./status-badge";

type MandateChoice = Mandate & { familyId: string; hash: string };
type ProposalResult = { proposal: { cart: { lineItems: { productId: string; title: string; quantity: number; unitPriceCents: number }[]; totalCents: number } }; decision: { id: string; verdict: "APPROVE" | "REVIEW" | "BLOCK"; reasons: string[] }; rationale: string };

export function AgentRunner({ mandates }: { mandates: MandateChoice[] }) {
  const [mandateId, setMandateId] = useState(mandates[0]?.mandateId ?? "");
  const [request, setRequest] = useState("Reorder the A4 recycled paper described by my mandate.");
  const [results, setResults] = useState<ProposalResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fallback, setFallback] = useState(false);

  async function run(mode: "scripted" | "live") {
    setBusy(true); setError(""); setResults([]); setFallback(false);
    try {
      const scenarios = mode === "scripted" ? ["compliant", "overbudget-premium", "mislabeled"] : [undefined];
      const all: ProposalResult[] = [];
      for (const scenario of scenarios) {
        const response = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, mandateId, request, ...(scenario ? { scenario } : {}) }) });
        const value = await response.json() as { proposals?: ProposalResult[]; error?: string; fallback?: boolean };
        if (!response.ok) throw new Error(response.status >= 500 ? "Agent results could not be saved. Please try again." : value.error ?? "Agent run failed.");
        all.push(...(value.proposals ?? []));
        setFallback((current) => current || Boolean(value.fallback));
        if (value.error && !value.fallback) setError(value.error);
      }
      setResults(all);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent run failed"); }
    finally { setBusy(false); }
  }

  if (!mandates.length) return <section className="empty-state"><h2>No confirmed mandate yet</h2><p>Create and confirm a mandate before running an agent.</p><a className="button button-primary" href="/mandates/new">Create mandate</a></section>;
  return <div className="stack-lg">
    <section className="panel stack-md">
      <label><span className="field-label">Confirmed mandate</span><select value={mandateId} onChange={(event) => setMandateId(event.target.value)}>{mandates.map((mandate) => <option key={mandate.mandateId} value={mandate.mandateId}>Version {mandate.version} · {mandate.originalText}</option>)}</select></label>
      <label><span className="field-label">Live agent instruction</span><textarea rows={2} value={request} onChange={(event) => setRequest(event.target.value)} /></label>
      <div className="row-wrap"><button className="button button-primary" type="button" onClick={() => run("scripted")} disabled={busy}>{busy ? "Running…" : "Run scripted agent"}</button><button className="button button-secondary" type="button" onClick={() => run("live")} disabled={busy}>{busy ? "Running…" : "Run live agent"}</button></div>
      <p className="small-muted">Scripted scenarios are repeatable. The live model only proposes products; the server prices and checks each cart.</p>
      {busy && <p className="progress-indicator" role="status" aria-live="polite"><span className="progress-spinner" aria-hidden="true" /> Running the agent and checking proposals…</p>}
      {fallback && <p className="notice notice-warn" role="status">AI check unavailable. Proposals were sent to REVIEW.</p>}
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
    </section>
    {results.length > 0 && <section className="stack-md"><div className="section-heading"><div><p className="eyebrow">PROPOSALS</p><h2>Decision results</h2></div><span>{results.length} proposal{results.length === 1 ? "" : "s"}</span></div><div className="card-grid">
      {results.map((item, index) => <article className="panel proposal-card" key={`${item.decision.id}-${index}`}><div className="row-between"><h3>{item.proposal.cart.lineItems[0]?.title ?? "Cart proposal"}</h3><StatusBadge verdict={item.decision.verdict} /></div><ul className="line-list">{item.proposal.cart.lineItems.map((line) => <li key={line.productId}><span>{line.quantity} × {line.title}</span><span>{formatUsd(line.unitPriceCents * line.quantity)}</span></li>)}</ul><div className="row-between total-row"><strong>Total</strong><strong>{formatUsd(item.proposal.cart.totalCents)}</strong></div><p>{item.decision.reasons[0] ?? item.rationale}</p><a className="text-link" href={`/purchases/${item.decision.id}`}>Review decision →</a></article>)}
    </div></section>}
  </div>;
}
