import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fixture from "../fixtures/scenarios.json";
import { CartSchema } from "../../src/lib/schemas/cart";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import type { Store, MandateRecord, CartProposalRecord, DecisionRecord } from "../../src/lib/store/types";
import { MemoryStore } from "../../src/lib/store/memory";
import { PrismaStore } from "../../src/lib/store/prisma";
import { getPrismaClient } from "../../src/lib/db/prisma";
import { canonicalJson, sha256Hex } from "../../src/lib/hash";

const baseMandate = MandateSchema.parse(fixture.baseMandate);
const cart = CartSchema.parse(fixture.scenarios.find((item) => item.id === "C01")?.cart);

function buildRecords(): { mandate: MandateRecord; proposal: CartProposalRecord; decision: DecisionRecord } {
  const mandateId = randomUUID();
  const familyId = randomUUID();
  const mandate = { ...baseMandate, mandateId, familyId, hash: "test-hash" };
  const proposal: CartProposalRecord = { id: randomUUID(), mandateId, cart, cartHash: sha256Hex(canonicalJson(cart)), source: "AGENT_SCRIPTED" };
  const decision: DecisionRecord = { id: randomUUID(), cartProposalId: proposal.id, mandateHash: "m-hash", cartHash: proposal.cartHash,
    verdict: "APPROVE", ruleResults: [], aiResult: null, reasons: [], createdAt: new Date().toISOString() };
  return { mandate, proposal, decision };
}

function contract(name: string, getStore: () => Promise<Store>, enabled: boolean) {
  describe.skipIf(!enabled)(`${name} Store contract`, () => {
    let store: Store;
    beforeAll(async () => { store = await getStore(); });
    beforeEach(async () => { await store.clearDemoData(); });
    afterAll(async () => { await store.clearDemoData(); if (name === "Prisma") await getPrismaClient().$disconnect(); });

    it("persists the Store contract shapes and enforces result parsing", async () => {
      const { mandate, proposal, decision } = buildRecords();
      await store.createMandate(mandate);
      expect(await store.getMandate(mandate.mandateId)).toEqual(mandate);
      expect(await store.listMandatesByFamily(mandate.familyId)).toHaveLength(1);
      await store.createCartProposal(proposal);
      expect(await store.getCartProposal(proposal.id)).toMatchObject(proposal);
      await store.createDecision(decision);
      expect(await store.getDecision(decision.id)).toMatchObject(decision);
      expect(await store.listDecisions()).toHaveLength(1);
      const approval = { id: randomUUID(), decisionId: decision.id, note: "checked", createdAt: new Date().toISOString() };
      await store.createHumanApproval(approval);
      expect(await store.getHumanApprovalByDecision(decision.id)).toMatchObject(approval);
      const order = { id: randomUUID(), decisionId: decision.id, paypalOrderId: randomUUID(), status: "CREATED", totalCents: cart.totalCents, currency: cart.currency, captureId: null, createdAt: new Date().toISOString() };
      await store.createPayPalOrder(order);
      expect(await store.getPayPalOrderByDecision(decision.id)).toMatchObject(order);
      expect(await store.getPayPalOrderByPayPalId(order.paypalOrderId)).toMatchObject(order);
      await store.updatePayPalOrder({ ...order, status: "COMPLETED", captureId: "capture" });
      expect(await store.getPayPalOrder(order.id)).toMatchObject({ status: "COMPLETED", captureId: "capture" });
      await store.setSemanticCheckCache("p1", "m1", "mh", "ch", { verdict: "APPROVE", reasons: [] });
      expect(await store.getSemanticCheckCache("p1", "m1", "mh", "ch")).toEqual({ verdict: "APPROVE", reasons: [] });
      await store.appendAuditEvent({ type: "TEST", payload: { safe: true }, prevHash: "", hash: "chain-hash", createdAt: new Date().toISOString() });
      expect(await store.listAuditEvents()).toHaveLength(1);
    });
  });
}

contract("Memory", async () => new MemoryStore(), true);
const prismaEnabled = process.env.RUN_PRISMA_STORE_TESTS === "1" && Boolean(process.env.DATABASE_URL);
contract("Prisma", async () => new PrismaStore(getPrismaClient()), prismaEnabled);
