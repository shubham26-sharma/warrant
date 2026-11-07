import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PurchaseActions } from "@/app/components/purchase-actions";
import { StatusBadge } from "@/app/components/status-badge";
import { getStore } from "@/lib/runtime";
import { formatUsd } from "@/lib/money";
import type { Cart } from "@/lib/schemas/cart";

function cartValue(path: string, cart: Cart): string {
  if (path === "cart.currency") return cart.currency;
  if (path === "cart.merchantId") return cart.merchantId;
  if (path === "cart.totalCents") return formatUsd(cart.totalCents);
  if (path === "cart.deliveryDays") return cart.deliveryDays === null ? "Unknown" : `${cart.deliveryDays} days`;
  if (path === "cart.lineItems[].quantity") return String(cart.lineItems.reduce((sum, item) => sum + item.quantity, 0));
  if (path.includes("subtotalCents")) return `${formatUsd(cart.subtotalCents)} subtotal / ${formatUsd(cart.totalCents)} total`;
  const attributeMatch = /cart\.lineItems\[(\d+)\]\.attributes\.(.+)/.exec(path);
  if (attributeMatch) return String(cart.lineItems[Number(attributeMatch[1])]?.attributes[attributeMatch[2]] ?? "Missing");
  return cart.lineItems.map((item) => `${item.title} · ${item.quantity} units`).join("; ");
}

export default async function PurchasePage({ params }: PageProps<"/purchases/[decisionId]">) {
  await connection();
  const { decisionId } = await params;
  const store = getStore();
  const decision = await store.getDecision(decisionId);
  if (!decision) notFound();
  const proposal = await store.getCartProposal(decision.cartProposalId);
  if (!proposal) notFound();
  const mandate = await store.getMandate(proposal.mandateId);
  if (!mandate) notFound();
  const approval = await store.getHumanApprovalByDecision(decisionId);
  const order = await store.getPayPalOrderByDecision(decisionId);

  return <div className="stack-lg">
    <div className="page-heading"><p className="eyebrow">PURCHASE DECISION</p><div className="row-wrap"><h1 style={{ margin: 0 }}>Cart review</h1><StatusBadge verdict={decision.verdict} /></div><p>Decision <code>{decision.id}</code> · mandate version {mandate.version} · PayPal Sandbox</p></div>
    <section className="panel stack-md"><div className="row-between"><div><p className="eyebrow">MANDATE VS CART</p><h2 className="panel-title">Rule results</h2></div><span className="tag">{proposal.cart.lineItems.length} line item(s)</span></div>
      <div className="table-scroll"><table className="diff-table"><thead><tr><th>Rule</th><th>Mandate requirement</th><th>Cart value</th><th>Result</th></tr></thead><tbody>
        {decision.ruleResults.map((rule, index) => <tr key={`${rule.ruleId}-${index}`}><td><code>{rule.ruleId}</code></td><td>{rule.mandateClause}</td><td>{cartValue(rule.cartPath, proposal.cart)}<br /><span className="small-muted">{rule.cartPath}</span></td><td><span className={rule.passed ? "passed" : "failed"}>{rule.passed ? "PASS" : rule.severity}</span><br /><span className="small-muted">{rule.message}</span></td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel stack-md ai-panel"><div><p className="eyebrow">AI ASSESSMENT · CAN ONLY TIGHTEN</p><h2 className="panel-title">Semantic review</h2></div>
      {decision.aiResult ? <><StatusBadge verdict={decision.aiResult.verdict} /><ul>{decision.aiResult.reasons.length ? decision.aiResult.reasons.map((reason, index) => <li key={index}>{reason}</li>) : <li>No additional semantic concerns.</li>}</ul></> : <p className="small-muted">AI assessment was skipped because a deterministic BLOCK already applied.</p>}
    </section>
    <section className="panel stack-md"><div><p className="eyebrow">NEXT STEP</p><h2 className="panel-title">Human-present checkout</h2></div>
      {decision.reasons.length > 0 && <ul>{decision.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      <PurchaseActions decisionId={decisionId} mandateId={mandate.mandateId} verdict={decision.verdict} approved={Boolean(approval)} orderStatus={order?.status} />
      <p className="small-muted">Any PayPal action opens the sandbox buyer approval page. No autonomous payment occurs.</p>
    </section>
    <Link className="text-link" href="/audit">Open audit trail →</Link>
  </div>;
}
