import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import fixture from "../fixtures/scenarios.json";
import { CartSchema } from "../../src/lib/schemas/cart";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import type { Store, MandateRecord, CartProposalRecord, DecisionRecord } from "../../src/lib/store/types";
import { MemoryStore } from "../../src/lib/store/memory";
import { PrismaStore } from "../../src/lib/store/prisma";
import { getPrismaClient } from "../../src/lib/db/prisma";
import { canonicalJson, sha256Hex } from "../../src/lib/hash";

dotenv.config({ path: ".env.local" });

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
    let prismaArtifacts: { mandateId: string; proposalId: string; decisionId: string; orderId?: string; auditId?: number; cacheKey?: { promptVersion: string; modelName: string; mandateHash: string; cartHash: string } } | null = null;
    beforeAll(async () => { store = await getStore(); });
    beforeEach(async () => { if (name === "Memory") await store.clearDemoData(); prismaArtifacts = null; });
    afterAll(async () => {
      if (name === "Memory") await store.clearDemoData();
      if (name === "Prisma") {
        const prisma = getPrismaClient();
        if (prismaArtifacts) {
          const artifacts = prismaArtifacts;
          await prisma.$transaction(async (tx) => {
            if (artifacts.orderId) await tx.payPalOrder.deleteMany({ where: { id: artifacts.orderId } });
            await tx.humanApproval.deleteMany({ where: { decisionId: artifacts.decisionId } });
            await tx.decision.deleteMany({ where: { id: artifacts.decisionId } });
            await tx.cartProposal.deleteMany({ where: { id: artifacts.proposalId } });
            await tx.mandate.deleteMany({ where: { id: artifacts.mandateId } });
            if (artifacts.auditId) await tx.auditEvent.deleteMany({ where: { id: artifacts.auditId } });
            if (artifacts.cacheKey) await tx.semanticCache.deleteMany({ where: artifacts.cacheKey });
          });
        }
        await prisma.$disconnect();
      }
    });

    it("persists the Store contract shapes and enforces result parsing", async () => {
      const { mandate, proposal, decision } = buildRecords();
      if (name === "Prisma") prismaArtifacts = { mandateId: mandate.mandateId, proposalId: proposal.id, decisionId: decision.id };
      await store.createMandate(mandate);
      expect(await store.getMandate(mandate.mandateId)).toEqual(mandate);
      expect(await store.listMandatesByFamily(mandate.familyId)).toHaveLength(1);
      await store.createCartProposal(proposal);
      expect(await store.getCartProposal(proposal.id)).toMatchObject(proposal);
      await store.createDecision(decision);
      expect(await store.getDecision(decision.id)).toMatchObject(decision);
      expect(await store.listDecisions()).toEqual(expect.arrayContaining([expect.objectContaining({ id: decision.id })]));
      const approval = { id: randomUUID(), decisionId: decision.id, note: "checked", createdAt: new Date().toISOString() };
      await store.createHumanApproval(approval);
      expect(await store.getHumanApprovalByDecision(decision.id)).toMatchObject(approval);
      const order = { id: randomUUID(), decisionId: decision.id, paypalOrderId: randomUUID(), status: "CREATED", totalCents: cart.totalCents, currency: cart.currency, captureId: null, createdAt: new Date().toISOString() };
      await store.createPayPalOrder(order);
      if (prismaArtifacts) prismaArtifacts.orderId = order.id;
      expect(await store.getPayPalOrderByDecision(decision.id)).toMatchObject(order);
      expect(await store.getPayPalOrderByPayPalId(order.paypalOrderId)).toMatchObject(order);
      await store.updatePayPalOrder({ ...order, status: "COMPLETED", captureId: "capture" });
      expect(await store.getPayPalOrder(order.id)).toMatchObject({ status: "COMPLETED", captureId: "capture" });
      await store.setSemanticCheckCache("p1", "m1", "mh", "ch", { verdict: "APPROVE", reasons: [] });
      if (prismaArtifacts) prismaArtifacts.cacheKey = { promptVersion: "p1", modelName: "m1", mandateHash: "mh", cartHash: "ch" };
      expect(await store.getSemanticCheckCache("p1", "m1", "mh", "ch")).toEqual({ verdict: "APPROVE", reasons: [] });
      if (name === "Memory") {
        const event = await store.appendAuditEvent({ type: "TEST", payload: { safe: true }, prevHash: "", hash: "chain-hash", createdAt: new Date().toISOString() });
        expect(await store.listAuditEvents()).toEqual([event]);
      } else {
        // Do not append synthetic events to the shared database's immutable audit chain.
        expect(await store.listAuditEvents()).toEqual(expect.any(Array));
      }
    }, name === "Prisma" ? 30_000 : 5_000);
  });
}

contract("Memory", async () => new MemoryStore(), true);
const prismaEnabled = process.env.RUN_PRISMA_STORE_TESTS === "1" && Boolean(process.env.DATABASE_URL);
contract("Prisma", async () => new PrismaStore(getPrismaClient()), prismaEnabled);
