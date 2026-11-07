import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { MemoryStore } from "../../src/lib/store/memory";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import type { MandateRecord } from "../../src/lib/store/types";
import type { AiBudgetContext } from "../../src/lib/ai/budget";

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
    expect(body.error).toBe("AI check unavailable");
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]?.decision.verdict).toBe("REVIEW");
    expect(body.proposals[0]?.decision.reasons).toContain("AI check unavailable");
    expect(await store.getDecision(body.proposals[0]!.decision.id)).toMatchObject({ verdict: "REVIEW", reasons: expect.arrayContaining(["AI check unavailable"]) });
  });
});
