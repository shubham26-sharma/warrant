import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import fixture from "../fixtures/scenarios.json";
import { MemoryStore } from "../../src/lib/store/memory";
import { PrismaStore } from "../../src/lib/store/prisma";
import { getPrismaClient } from "../../src/lib/db/prisma";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import type { MandateRecord } from "../../src/lib/store/types";
import type { AiBudgetContext } from "../../src/lib/ai/budget";

dotenv.config({ path: ".env.local" });

const runtimeState = vi.hoisted(() => ({ store: undefined as unknown }));
const mockRunAgent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({ getStore: () => runtimeState.store }));
vi.mock("@/lib/ai/agent", () => ({ runAgent: mockRunAgent }));

import { POST } from "@/app/api/agent/run/route";

describe("agent route fail-closed behavior", () => {
  let store: MemoryStore;
  let mandate: MandateRecord;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("AI_TIMEOUT_MS", "5");
    store = new MemoryStore();
    const parsed = MandateSchema.parse(fixture.baseMandate);
    mandate = { ...parsed, familyId: parsed.mandateId, hash: "route-test-hash" };
    await store.createMandate(mandate);
    runtimeState.store = store;
    mockRunAgent.mockImplementation(async (...args: unknown[]) => {
      const budget = args[3] as AiBudgetContext | undefined;
      if (!budget?.signal) throw new Error("The route did not pass its AI time budget");
      await new Promise<never>((_resolve, reject) => {
        budget.signal.addEventListener("abort", () => reject(new Error("simulated agent timeout")), { once: true });
      });
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 200 with a persisted REVIEW decision when the live agent times out", async () => {
    const response = await POST(new Request("http://localhost/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `agent-timeout-${Date.now()}` },
      body: JSON.stringify({ mode: "live", mandateId: mandate.mandateId, request: "Reorder the paper from my confirmed mandate." }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      fallback: boolean;
      error: string;
      proposals: { decision: { id: string; verdict: string; reasons: string[] } }[];
    };
    expect(body.fallback).toBe(true);
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(body.error).toBe("AI check unavailable");
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]?.decision.verdict).toBe("REVIEW");
    expect(body.proposals[0]?.decision.reasons).toContain("AI check unavailable");
    expect(await store.getDecision(body.proposals[0]!.decision.id)).toMatchObject({ verdict: "REVIEW", reasons: expect.arrayContaining(["AI check unavailable"]) });
  });

  it("does not expose raw database errors to the agent UI", async () => {
    runtimeState.store = new Proxy(store, { get(target, property) {
      if (property === "appendAuditEvent") return async () => { throw new Error("private database connection detail"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });

    const response = await POST(new Request("http://localhost/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `agent-db-error-${Date.now()}` },
      body: JSON.stringify({ mode: "live", mandateId: mandate.mandateId, request: "Reorder paper." }),
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Agent run failed. Please try again." });
  });
});

const prismaEnabled = process.env.RUN_PRISMA_STORE_TESTS === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!prismaEnabled)("agent route Prisma timeout integration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns 200 with a persisted REVIEW decision after timeout, then rolls it back", async () => {
    vi.stubEnv("AI_TIMEOUT_MS", "5");
    vi.clearAllMocks();
    mockRunAgent.mockImplementation(async (...args: unknown[]) => {
      const budget = args[3] as AiBudgetContext | undefined;
      if (!budget?.signal) throw new Error("The route did not pass its AI time budget");
      await new Promise<never>((_resolve, reject) => {
        budget.signal.addEventListener("abort", () => reject(new Error("simulated agent timeout")), { once: true });
      });
    });

    const prisma = getPrismaClient();
    const parsed = MandateSchema.parse(fixture.baseMandate);
    const mandate: MandateRecord = {
      ...parsed,
      mandateId: randomUUID(),
      familyId: randomUUID(),
      hash: "rollback-route-test",
    };
    let decisionId = "";
    class RollbackRouteTest extends Error {}

    await expect(prisma.$transaction(async (tx) => {
      const store = new PrismaStore(tx, true);
      await store.createMandate(mandate);
      runtimeState.store = store;

      const response = await POST(new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": `agent-prisma-timeout-${mandate.mandateId}` },
        body: JSON.stringify({ mode: "live", mandateId: mandate.mandateId, request: "Reorder paper." }),
      }));

      expect(response.status).toBe(200);
      const body = await response.json() as {
        fallback: boolean;
        proposals: { decision: { id: string; verdict: string; reasons: string[] } }[];
      };
      expect(body.fallback).toBe(true);
      expect(mockRunAgent).toHaveBeenCalledTimes(1);
      expect(body.proposals).toHaveLength(1);
      const result = body.proposals[0]!.decision;
      decisionId = result.id;
      expect(result.verdict).toBe("REVIEW");
      expect(result.reasons).toContain("AI check unavailable");
      expect(await store.getDecision(decisionId)).toMatchObject({ verdict: "REVIEW" });
      const auditEvents = (await store.listAuditEvents()).filter((event) => event.type === "CART_PROPOSAL_EVALUATED");
      expect(auditEvents.some((event) => (event.payload as { decisionId?: string }).decisionId === decisionId)).toBe(true);
      throw new RollbackRouteTest("rollback route integration rows");
    }, { maxWait: 15_000, timeout: 30_000 })).rejects.toThrow("rollback route integration rows");

    expect(await prisma.decision.findUnique({ where: { id: decisionId } })).toBeNull();
    const auditEvents = await prisma.auditEvent.findMany({ where: { type: "CART_PROPOSAL_EVALUATED" } });
    expect(auditEvents.some((event) => (event.payload as { decisionId?: string }).decisionId === decisionId)).toBe(false);
  }, 45_000);
});
