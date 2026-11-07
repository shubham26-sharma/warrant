"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/money";

type ReturnResult = { order?: { paypalOrderId: string; status: string; captureId: string | null; totalCents: number; currency: string }; alreadyCaptured?: boolean; error?: string };

export function PayPalReturnClient({ orderId }: { orderId: string }) {
  const [result, setResult] = useState<ReturnResult | null>(orderId ? null : { error: "PayPal did not return an order id." });
  const [busy, setBusy] = useState(Boolean(orderId));
  useEffect(() => {
    if (!orderId) return;
    fetch("/api/paypal/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: orderId }) })
      .then(async (response) => ({ ok: response.ok, body: await response.json() as ReturnResult }))
      .then(({ ok, body }) => setResult(ok ? body : { error: body.error ?? "PayPal completion failed." }))
      .catch(() => setResult({ error: "Could not verify the PayPal order. Please contact the demo operator." }))
      .finally(() => setBusy(false));
  }, [orderId]);

  if (busy) return <section className="panel"><p className="eyebrow">PAYPAL SANDBOX</p><h1>Verifying order…</h1><p>Please keep this page open.</p></section>;
  if (result?.error) return <section className="panel"><p className="eyebrow">PAYPAL SANDBOX</p><h1>Order needs attention</h1><p className="notice notice-error" role="alert">{result.error}</p><a className="text-link" href="/audit">Open audit trail →</a></section>;
  const order = result?.order;
  return <section className="panel stack-md" role="status"><p className="eyebrow">PAYPAL SANDBOX</p><h1>{order?.status === "COMPLETED" ? "Payment captured" : "Order status"}</h1>
    <dl className="detail-list"><dt>Order id</dt><dd>{order?.paypalOrderId}</dd><dt>Capture id</dt><dd>{order?.captureId ?? "Not captured"}</dd><dt>Amount</dt><dd>{order ? formatUsd(order.totalCents) : "—"} {order?.currency}</dd></dl>
    <a className="button button-primary" href="/audit">View audit trail</a>
  </section>;
}
