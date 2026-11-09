"use client";

import { useState } from "react";
import { MandateSchema, type Mandate, type MandateDraft } from "@/lib/schemas/mandate";
import { applyAttributeSuggestion } from "@/lib/mandates/draft-suggestions";

const example = "Reorder up to 5 packs of A4 recycled paper, max $60 including delivery and tax, delivered within 3 days, Warrant Demo Store only";
type Confirmed = Mandate & { familyId: string; hash: string };

function centsFromInput(value: string): number | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export function MandateBuilder({ initialMandate }: { initialMandate?: Confirmed | null }) {
  const [text, setText] = useState(initialMandate?.originalText ?? "");
  const [draft, setDraft] = useState<MandateDraft | null>(initialMandate ? { ...initialMandate, suggestions: [], status: "DRAFT", confirmedAt: null } : null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Confirmed | null>(null);
  const editing = Boolean(initialMandate);

  const updateHard = (patch: Partial<MandateDraft["hardConstraints"]>) => {
    setDraft((current) => current ? { ...current, hardConstraints: { ...current.hardConstraints, ...patch } } : current);
  };
  const updateSoft = (patch: Partial<Mandate["softConstraints"]>) => {
    setDraft((current) => current ? { ...current, softConstraints: { ...current.softConstraints, ...patch } } : current);
  };

  async function compile() {
    setBusy(true); setError(""); setSaved(null);
    try {
      const response = await fetch("/api/mandates/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, currency: "USD" }) });
      const value = await response.json() as Mandate | { error?: string };
      if (!response.ok) {
        const message = "error" in value ? value.error : undefined;
        const code = response.headers.get("x-ai-error-code");
        if (response.status === 503) {
          switch (code) {
            case "AI_NOT_CONFIGURED":
              throw new Error("AI is not configured. Please set GEMINI_API_KEY and GEMINI_MODEL in the environment.");
            case "AI_AUTH":
              throw new Error("AI authentication failed. Please verify your GEMINI_API_KEY in the environment.");
            case "AI_MODEL_NOT_FOUND":
              throw new Error("AI model not found. Please verify GEMINI_MODEL in the environment.");
            case "AI_QUOTA":
              throw new Error("AI rate limit or quota exceeded. Please try again in a minute.");
            case "AI_TIMEOUT":
              throw new Error("AI request timed out. Please try again in a moment.");
            case "AI_BAD_OUTPUT":
              throw new Error("AI returned an invalid output. Please rephrase your request and try again.");
            case "AI_UPSTREAM":
              throw new Error("AI service is temporarily unavailable. Please try again in a minute.");
            default:
              throw new Error("AI is temporarily unavailable, so your mandate draft was not compiled. Check the Gemini connection and try again.");
          }
        }
        throw new Error(message ?? "Mandate compilation failed. Please try again.");
      }
      const compiled = value as MandateDraft;
      setDraft(compiled);
      setAnswers(Object.fromEntries(compiled.ambiguity.unresolvedClauses.map((clause) => [clause, ""])));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI check unavailable"); }
    finally { setBusy(false); }
  }

  function resolveClause(clause: string, answer: string) {
    setAnswers((current) => ({ ...current, [clause]: answer }));
    setDraft((current) => {
      if (!current) return current;
      const unresolvedClauses = answer.trim()
        ? current.ambiguity.unresolvedClauses.filter((item) => item !== clause)
        : current.ambiguity.unresolvedClauses;
      const originalText = answer.trim() && current.originalText.includes(clause)
        ? current.originalText.replace(clause, answer.trim())
        : current.originalText;
      return { ...current, originalText, ambiguity: { hasAmbiguity: unresolvedClauses.length > 0, unresolvedClauses } };
    });
  }

  async function confirm() {
    if (!draft || draft.ambiguity.hasAmbiguity || draft.ambiguity.unresolvedClauses.length || !fieldsComplete) return;
    setBusy(true); setError("");
    try {
      const endpoint = "/api/mandates";
      const strictDraft = MandateSchema.parse({ ...draft, status: "DRAFT", confirmedAt: null });
      const body = editing && initialMandate
        ? { previousMandateId: initialMandate.mandateId, edits: {
            originalText: strictDraft.originalText, currency: strictDraft.currency,
            hardConstraints: strictDraft.hardConstraints, softConstraints: strictDraft.softConstraints,
            ambiguity: strictDraft.ambiguity,
          } }
        : { draft: strictDraft };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as Confirmed | { error?: string };
      if (!response.ok) throw new Error("error" in value ? value.error ?? "Confirmation failed" : "Confirmation failed");
      setSaved(value as Confirmed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not confirm mandate"); }
    finally { setBusy(false); }
  }

  const fieldsComplete = Boolean(draft && draft.hardConstraints.maximumTotalCents !== null && draft.hardConstraints.maximumTotalCents > 0 && draft.hardConstraints.maximumQuantity !== null && draft.hardConstraints.maximumDeliveryDays !== null && draft.hardConstraints.allowedMerchantIds.length > 0);
  const requiredText = draft?.hardConstraints.requiredAttributes.map((item) => `${item.key}=${item.value}`).join("\n") ?? "";
  const preferenceText = draft?.softConstraints.preferredAttributes.map((item) => `${item.key}=${item.value}`).join("\n") ?? "";

  return (
    <div className="stack-lg">
      {!editing && <section className="panel stack-md">
        <label className="field-label" htmlFor="request">What should the agent buy?</label>
        <textarea id="request" rows={4} maxLength={1000} value={text} onChange={(event) => setText(event.target.value)} placeholder={example} />
        <div className="row-wrap"><button className="button button-quiet" type="button" onClick={() => setText(example)}>Use example</button><button className="button button-primary" type="button" onClick={compile} disabled={busy || !text.trim()}>{busy ? "Compiling…" : "Compile draft"}</button></div>
      </section>}

      {draft && !saved && <section className="panel stack-md">
        <div><p className="eyebrow">{editing ? "EDIT CONFIRMED MANDATE" : "DRAFT · NEEDS HUMAN CONFIRMATION"}</p><h2 className="panel-title">Review structured constraints</h2></div>
        {draft.ambiguity.unresolvedClauses.map((clause) => <div className="ambiguity" key={clause}>
          <label className="field-label">Resolve this ambiguity: <mark>{clause}</mark></label>
          <input value={answers[clause] ?? ""} onChange={(event) => resolveClause(clause, event.target.value)} placeholder="Write a concrete requirement" />
        </div>)}
        {draft.suggestions.length > 0 && <div className="ambiguity"><p className="field-label">Optional suggestions · review before adding as requirements</p><div className="row-wrap">{draft.suggestions.map((suggestion) => <button className="button button-secondary" type="button" key={`${suggestion.key}=${suggestion.value}`} onClick={() => setDraft((current) => current ? applyAttributeSuggestion(current, suggestion) : current)}>Use {suggestion.key} = {suggestion.value}</button>)}</div></div>}
        <div className="form-grid">
          <label><span className="field-label">Maximum total (USD) {draft.hardConstraints.maximumTotalCents === null && <mark>required</mark>}</span><input className={draft.hardConstraints.maximumTotalCents === null ? "field-missing" : undefined} inputMode="decimal" value={draft.hardConstraints.maximumTotalCents === null ? "" : (draft.hardConstraints.maximumTotalCents / 100).toFixed(2)} onChange={(event) => { const cents = centsFromInput(event.target.value); updateHard({ maximumTotalCents: event.target.value.trim() ? cents : null }); }} /></label>
          <label><span className="field-label">Maximum quantity {draft.hardConstraints.maximumQuantity === null && <mark>required</mark>}</span><input className={draft.hardConstraints.maximumQuantity === null ? "field-missing" : undefined} type="number" min="1" step="1" value={draft.hardConstraints.maximumQuantity ?? ""} onChange={(event) => updateHard({ maximumQuantity: event.target.value ? (Number(event.target.value) > 0 && Number.isInteger(Number(event.target.value)) ? Number(event.target.value) : null) : null })} /></label>
          <label><span className="field-label">Maximum delivery days {draft.hardConstraints.maximumDeliveryDays === null && <mark>required</mark>}</span><input className={draft.hardConstraints.maximumDeliveryDays === null ? "field-missing" : undefined} type="number" min="1" step="1" value={draft.hardConstraints.maximumDeliveryDays ?? ""} onChange={(event) => updateHard({ maximumDeliveryDays: event.target.value ? (Number(event.target.value) > 0 && Number.isInteger(Number(event.target.value)) ? Number(event.target.value) : null) : null })} /></label>
          <label><span className="field-label">Allowed merchant ids {draft.hardConstraints.allowedMerchantIds.length === 0 && <mark>required</mark>}</span><input className={draft.hardConstraints.allowedMerchantIds.length === 0 ? "field-missing" : undefined} value={draft.hardConstraints.allowedMerchantIds.join(", ")} onChange={(event) => updateHard({ allowedMerchantIds: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
          <label><span className="field-label">Required attributes (one key=value per line)</span><textarea rows={3} value={requiredText} onChange={(event) => updateHard({ requiredAttributes: event.target.value.split("\n").filter((line) => line.includes("=")).map((line) => { const [key, ...value] = line.split("="); return { key: key.trim(), value: value.join("=").trim() }; }) })} /></label>
          <label><span className="field-label">Preferred attributes (one key=value per line)</span><textarea rows={3} value={preferenceText} onChange={(event) => updateSoft({ preferredAttributes: event.target.value.split("\n").filter((line) => line.includes("=")).map((line) => { const [key, ...value] = line.split("="); return { key: key.trim(), value: value.join("=").trim() }; }) })} /></label>
          <label><span className="field-label">Preferred brands (comma separated)</span><input value={draft.softConstraints.preferredBrands.join(", ")} onChange={(event) => updateSoft({ preferredBrands: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
          <label><span className="field-label">Currency</span><input value={draft.currency} maxLength={3} onChange={(event) => setDraft((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} /></label>
        </div>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button className="button button-primary" type="button" onClick={confirm} disabled={busy || !fieldsComplete || draft.ambiguity.hasAmbiguity || draft.ambiguity.unresolvedClauses.length > 0}>
          {busy ? "Saving…" : editing ? `Save version ${draft.version + 1}` : "Confirm mandate"}
        </button>
        <p className="small-muted">The agent can propose a cart only. A human confirms every mandate and every PayPal Sandbox order.</p>
      </section>}

      {saved && <section className="panel success-panel" role="status"><p className="eyebrow">CONFIRMED · VERSION {saved.version}</p><h2 className="panel-title">Mandate saved</h2><p>Hash: <code>{saved.hash.slice(0, 16)}…</code></p><a className="button button-primary" href="/agent">Continue to agent</a></section>}
      {error && !draft && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}
