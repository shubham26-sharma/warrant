import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fixture from "../fixtures/scenarios.json";
import { appendEvent, verifyChain } from "../../src/lib/audit/chain";
import { canonicalJson, sha256Hex } from "../../src/lib/hash";
import { evaluateCart } from "../../src/lib/guard/evaluate";
import { authorizeOrder, type OrderAuthorization } from "../../src/lib/gateway/authorize";
import { approveReview, completeCheckout, startCheckout } from "../../src/lib/gateway/purchase";
import type { PayPalClient } from "../../src/lib/paypal";
import type { DecisionRecord, PayPalOrderRecord } from "../../src/lib/store/types";
import { CartSchema } from "../../src/lib/schemas/cart";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import { MemoryStore } from "../../src/lib/store/memory";

const mandate = MandateSchema.parse(fixture.baseMandate);
const cart = CartSchema.parse(fixture.scenarios.find((scenario) => scenario.id === "C01")?.cart);

async function setup(verdict: DecisionRecord["verdict"] = "APPROVE") {
  const store = new MemoryStore();
  const familyId = "security-test-family";
  const mandateRecord = { ...mandate, familyId, hash: sha256Hex(canonicalJson({ ...mandate, familyId })) };
  await store.createMandate(mandateRecord);
  const proposalId = randomUUID();
  const cartHash = sha256Hex(canonicalJson(cart));
  await store.createCartProposal({ id: proposalId, mandateId: mandate.mandateId, cart, cartHash, source: "AGENT_SCRIPTED" });
  const evaluated = await evaluateCart(mandate, cart, async () => ({ verdict: "APPROVE", reasons: [] }));
  const decision: DecisionRecord = { id: evaluated.decisionId, cartProposalId: proposalId, mandateHash: evaluated.mandateHash,
    cartHash, verdict, ruleResults: evaluated.ruleResults, aiResult: evaluated.aiResult, reasons: evaluated.reasons, createdAt: evaluated.createdAt };
  await store.createDecision(decision);
  return { store, decision, mandateRecord };
}

function paypal(overrides: Partial<PayPalClient> = {}): PayPalClient {
  return {
    createPayPalOrder: vi.fn(async (_auth: OrderAuthorization) => { void _auth; return { orderId: "pp-order", status: "CREATED", approvalUrl: "https://paypal.test/approve" }; }),
    getPayPalOrder: vi.fn(async () => ({ orderId: "pp-order", status: "APPROVED", amountCents: cart.totalCents, currency: cart.currency, captureId: null })),
    capturePayPalOrder: vi.fn(async () => ({ orderId: "pp-order", status: "COMPLETED", amountCents: cart.totalCents, currency: cart.currency, captureId: "capture-1" })),
    ...overrides,
  };
}

describe("gateway security invariants", () => {
  it("blocks BLOCK and unapproved REVIEW before any PayPal request", async () => {
    const blocked = await setup("BLOCK");
    const client = paypal();
    await expect(authorizeOrder(blocked.store, blocked.decision.id)).rejects.toThrow(/Blocked/);
    expect(client.createPayPalOrder).not.toHaveBeenCalled();
    const review = await setup("REVIEW");
    await expect(authorizeOrder(review.store, review.decision.id)).rejects.toThrow(/requires manager approval/);
  });

  it("allows REVIEW only after approval and refuses approval for BLOCK", async () => {
    const review = await setup("REVIEW");
    await approveReview(review.store, review.decision.id, "Manually checked");
    await expect(authorizeOrder(review.store, review.decision.id)).resolves.toMatchObject({ decisionId: review.decision.id });
    const blocked = await setup("BLOCK");
    await expect(approveReview(blocked.store, blocked.decision.id, "no")).rejects.toThrow(/Only REVIEW/);
  });

  it("rejects changed carts and stale mandate versions", async () => {
    const changedCart = await setup();
    const tamperedStore = new Proxy(changedCart.store, { get(target, property) {
      if (property === "getCartProposal") return async (id: string) => {
        const proposal = await target.getCartProposal(id);
        return proposal ? { ...proposal, cart: { ...proposal.cart, totalCents: proposal.cart.totalCents + 1 } } : null;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(authorizeOrder(tamperedStore, changedCart.decision.id)).rejects.toThrow(/Cart changed/);

    const stale = await setup();
    await stale.store.createMandate({ ...stale.mandateRecord, mandateId: randomUUID(), version: stale.mandateRecord.version + 1 });
    await expect(authorizeOrder(stale.store, stale.decision.id)).rejects.toThrow(/newer confirmed/);
  });

  it("rejects a second order for a decision before calling PayPal", async () => {
    const state = await setup();
    const order: PayPalOrderRecord = { id: randomUUID(), decisionId: state.decision.id, paypalOrderId: "old-order", status: "CREATED", totalCents: cart.totalCents, currency: cart.currency, captureId: null, createdAt: new Date().toISOString() };
    await state.store.createPayPalOrder(order);
    const client = paypal();
    await expect(startCheckout(state.store, state.decision.id, { returnUrl: "https://app.test/return", cancelUrl: "https://app.test/cancel" }, client)).rejects.toThrow(/already exists/);
    expect(client.createPayPalOrder).not.toHaveBeenCalled();
  });

  it("logs CAPTURE_REJECTED and makes no capture on amount mismatch", async () => {
    const state = await setup();
    const order: PayPalOrderRecord = { id: randomUUID(), decisionId: state.decision.id, paypalOrderId: "pp-order", status: "CREATED", totalCents: cart.totalCents, currency: cart.currency, captureId: null, createdAt: new Date().toISOString() };
    await state.store.createPayPalOrder(order);
    const client = paypal({ getPayPalOrder: vi.fn(async () => ({ orderId: "pp-order", status: "APPROVED", amountCents: cart.totalCents + 1, currency: cart.currency, captureId: null })) });
    await expect(completeCheckout(state.store, order.paypalOrderId, client)).rejects.toThrow(/capture refused/);
    expect(client.capturePayPalOrder).not.toHaveBeenCalled();
    expect((await state.store.listAuditEvents()).map((event) => event.type)).toContain("CAPTURE_REJECTED");
  });

  it("captures once and returns the saved result on a retry", async () => {
    const state = await setup();
    const order: PayPalOrderRecord = { id: randomUUID(), decisionId: state.decision.id, paypalOrderId: "pp-order", status: "CREATED", totalCents: cart.totalCents, currency: cart.currency, captureId: null, createdAt: new Date().toISOString() };
    await state.store.createPayPalOrder(order);
    const client = paypal();
    expect((await completeCheckout(state.store, order.paypalOrderId, client)).order.captureId).toBe("capture-1");
    expect((await completeCheckout(state.store, order.paypalOrderId, client)).alreadyCaptured).toBe(true);
    expect(client.capturePayPalOrder).toHaveBeenCalledTimes(1);
  });

  it("detects stored audit event tampering at the event id", async () => {
    const store = new MemoryStore();
    await appendEvent(store, "ONE", { value: 1 });
    await appendEvent(store, "TWO", { value: 2 });
    const events = await store.listAuditEvents();
    events[1].payload = { value: 999 };
    const tampered = new Proxy(store, { get(target, property) {
      if (property === "listAuditEvents") return async () => events;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(await verifyChain(tampered)).toEqual({ ok: false, brokenAtId: 2 });
  });

  it("keeps PayPal module imports restricted to gateway code", () => {
    const root = join(process.cwd(), "src");
    const sourceFiles: Array<{ path: string; source: string }> = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push({ path, source: readFileSync(path, "utf8") });
      }
    };
    visit(root);
    const unauthorized = sourceFiles.filter(({ path, source }) =>
      /from\s+["'][^"']*(?:paypal\.tsx?|@\/lib\/paypal)[^"']*["']/i.test(source) && !path.includes(join("lib", "gateway")));
    expect(unauthorized).toEqual([]);
  });
});
