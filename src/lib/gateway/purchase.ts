import { randomUUID } from "node:crypto";
import { buildCart } from "../catalog/products";
import { appendEvent } from "../audit/chain";
import { canonicalJson, sha256Hex } from "../hash";
import { evaluateCart, type SemanticCheck } from "../guard/evaluate";
import { AiUnavailableError, type AiFailureCode, getAiClient } from "../ai/client";
import { createSemanticCheck } from "../ai/semantic-check";
import { CartSchema } from "../schemas/cart";
import { MandateSchema } from "../schemas/mandate";
import type { Store, DecisionRecord, PayPalOrderRecord } from "../store/types";
import { authorizeOrder } from "./authorize";
import { paypalClient, type PayPalClient } from "../paypal";

export class PurchaseFlowError extends Error {
  constructor(message: string) { super(message); this.name = "PurchaseFlowError"; }
}

export async function evaluateProposal(
  store: Store,
  mandateId: string,
  items: { productId: string; quantity: number }[],
  source: "AGENT_LIVE" | "AGENT_SCRIPTED",
  semanticCheck?: SemanticCheck,
) {
  const mandateRecord = await store.getMandate(mandateId);
  if (!mandateRecord || mandateRecord.status !== "CONFIRMED") throw new PurchaseFlowError("A persisted confirmed mandate is required");
  const mandate = MandateSchema.parse(mandateRecord);
  const cart = CartSchema.parse(buildCart(items));
  const cartHash = sha256Hex(canonicalJson(cart));
  const proposal = await store.createCartProposal({ id: randomUUID(), mandateId, cart, cartHash, source });
  const check = semanticCheck ?? createSemanticCheck(store, getAiClient());
  const decision = await evaluateCart(mandate, cart, check);
  const persisted: DecisionRecord = {
    id: decision.decisionId, cartProposalId: proposal.id, mandateHash: decision.mandateHash, cartHash: decision.cartHash,
    verdict: decision.verdict, ruleResults: decision.ruleResults, aiResult: decision.aiResult, reasons: decision.reasons, createdAt: decision.createdAt,
  };
  await store.createDecision(persisted);
  await appendEvent(store, "CART_PROPOSAL_EVALUATED", {
    proposalId: proposal.id, decisionId: persisted.id, mandateId, mandateVersion: mandate.version, source,
    cartHash, verdict: persisted.verdict, reasons: persisted.reasons,
    ...(decision.aiResult?.code ? { aiFailureCode: decision.aiResult.code } : {}),
  });
  return { proposal, decision: persisted };
}

export async function approveReview(store: Store, decisionId: string, note: string) {
  const decision = await store.getDecision(decisionId);
  if (!decision) throw new PurchaseFlowError("Decision not found");
  if (decision.verdict !== "REVIEW") throw new PurchaseFlowError("Only REVIEW decisions can receive manager approval");
  if (!note.trim()) throw new PurchaseFlowError("An approval note is required");
  const approval = await store.createHumanApproval({ id: randomUUID(), decisionId, note: note.trim(), createdAt: new Date().toISOString() });
  await appendEvent(store, "REVIEW_APPROVED", { decisionId, approvalId: approval.id, note: approval.note });
  return approval;
}

export async function startCheckout(
  store: Store,
  decisionId: string,
  urls: { returnUrl: string; cancelUrl: string },
  client: PayPalClient = paypalClient,
) {
  const auth = await authorizeOrder(store, decisionId);
  const created = await client.createPayPalOrder(auth, urls);
  const record: PayPalOrderRecord = {
    id: randomUUID(), decisionId, paypalOrderId: created.orderId, status: created.status,
    totalCents: auth.totalCents, currency: auth.currency, captureId: null, createdAt: new Date().toISOString(),
  };
  const saved = await store.createPayPalOrder(record);
  await appendEvent(store, "PAYPAL_ORDER_CREATED", { decisionId, orderId: saved.paypalOrderId, status: saved.status, totalCents: saved.totalCents, currency: saved.currency });
  return { ...saved, approvalUrl: created.approvalUrl };
}

export async function completeCheckout(store: Store, paypalOrderId: string, client: PayPalClient = paypalClient) {
  const saved = await store.getPayPalOrderByPayPalId(paypalOrderId);
  if (!saved) throw new PurchaseFlowError("Stored PayPal order not found");
  if (saved.captureId) return { order: saved, alreadyCaptured: true };
  const current = await client.getPayPalOrder(paypalOrderId);
  if (current.status !== "APPROVED" || current.amountCents !== saved.totalCents || current.currency !== saved.currency) {
    await appendEvent(store, "CAPTURE_REJECTED", {
      orderId: paypalOrderId, expectedStatus: "APPROVED", actualStatus: current.status,
      expectedAmountCents: saved.totalCents, actualAmountCents: current.amountCents,
      expectedCurrency: saved.currency, actualCurrency: current.currency,
    });
    throw new PurchaseFlowError("PayPal order does not match the authorized snapshot; capture refused");
  }
  const captured = await client.capturePayPalOrder(paypalOrderId);
  if (captured.status !== "COMPLETED" || !captured.captureId) throw new PurchaseFlowError("PayPal did not confirm a completed capture");
  const updated = await store.updatePayPalOrder({ ...saved, status: captured.status, captureId: captured.captureId });
  await appendEvent(store, "PAYPAL_CAPTURE_COMPLETED", { decisionId: saved.decisionId, orderId: paypalOrderId, captureId: updated.captureId, totalCents: saved.totalCents, currency: saved.currency });
  return { order: updated, alreadyCaptured: false };
}

export function unavailableSemanticCheck(code: AiFailureCode = "AI_UPSTREAM"): SemanticCheck {
  return async () => { throw new AiUnavailableError("Gemini is unavailable", { code }); };
}
