import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { AiUnavailableError, classifyAiError, getAiClient } from "../../src/lib/ai/client";
import { createSemanticCheck, SEMANTIC_PROMPT_VERSION } from "../../src/lib/ai/semantic-check";
import { PRODUCTS } from "../../src/lib/catalog/products";
import { evaluateProposal } from "../../src/lib/gateway/purchase";
import { evaluateCart } from "../../src/lib/guard/evaluate";
import { CartSchema } from "../../src/lib/schemas/cart";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import { MemoryStore } from "../../src/lib/store/memory";

const createInteractionMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    interactions = { create: createInteractionMock };
  },
}));

const mandate = MandateSchema.parse(fixture.baseMandate);
const compliantCart = CartSchema.parse(fixture.scenarios.find((item) => item.id === "C01")?.cart);
const overbudgetCart = CartSchema.parse(fixture.scenarios.find((item) => item.id === "B01")?.cart);

describe("AI failure classification, retry policy, and guard safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
    vi.stubEnv("AI_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("failure classification", () => {
    it("classifies missing configuration as AI_NOT_CONFIGURED", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      const client = getAiClient();
      await expect(client.generateStructured({ jsonSchema: { type: "object" }, parse: (v) => v }, "sys", "usr"))
        .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    });

    it("classifies missing model as AI_NOT_CONFIGURED", () => {
      vi.stubEnv("GEMINI_MODEL", "");
      const client = getAiClient();
      expect(() => client.getModelName()).toThrowError(expect.objectContaining({ code: "AI_NOT_CONFIGURED" }));
    });

    it("classifies 401 and 403 as AI_AUTH", () => {
      expect(classifyAiError({ status: 401 })).toMatchObject({ code: "AI_AUTH", status: 401 });
      expect(classifyAiError({ status: 403 })).toMatchObject({ code: "AI_AUTH", status: 403 });
      expect(classifyAiError(new Error("API_KEY_INVALID"))).toMatchObject({ code: "AI_AUTH" });
    });

    it("classifies 404 as AI_MODEL_NOT_FOUND", () => {
      expect(classifyAiError({ status: 404 })).toMatchObject({ code: "AI_MODEL_NOT_FOUND", status: 404 });
      expect(classifyAiError(new Error("models/gemini-unknown not found"))).toMatchObject({ code: "AI_MODEL_NOT_FOUND" });
    });

    it("classifies 429 and resource exhaustion as AI_QUOTA", () => {
      expect(classifyAiError({ status: 429 })).toMatchObject({ code: "AI_QUOTA", status: 429 });
      expect(classifyAiError(new Error("Resource exhausted: quota exceeded"))).toMatchObject({ code: "AI_QUOTA" });
    });

    it("classifies timeout and abort as AI_TIMEOUT", () => {
      const controller = new AbortController();
      controller.abort();
      expect(classifyAiError(new Error("Request aborted"), controller.signal)).toMatchObject({ code: "AI_TIMEOUT" });
      expect(classifyAiError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toMatchObject({ code: "AI_TIMEOUT" });
    });

    it("classifies 400, malformed JSON, and schema mismatch as AI_BAD_OUTPUT", () => {
      expect(classifyAiError({ status: 400 })).toMatchObject({ code: "AI_BAD_OUTPUT", status: 400 });
      expect(classifyAiError(new SyntaxError("Unexpected token in JSON"))).toMatchObject({ code: "AI_BAD_OUTPUT" });
      expect(classifyAiError(new Error("Gemini output failed schema validation"))).toMatchObject({ code: "AI_BAD_OUTPUT" });
    });

    it("classifies 5xx and network resets as AI_UPSTREAM", () => {
      expect(classifyAiError({ status: 500 })).toMatchObject({ code: "AI_UPSTREAM", status: 500 });
      expect(classifyAiError({ status: 503 })).toMatchObject({ code: "AI_UPSTREAM", status: 503 });
      expect(classifyAiError({ code: "ECONNRESET" })).toMatchObject({ code: "AI_UPSTREAM" });
    });
  });

  describe("retry policy", () => {
    it("retries 5xx once then fails with AI_UPSTREAM", async () => {
      createInteractionMock
        .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
        .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" });

      const client = getAiClient();
      await expect(client.generateStructured({ jsonSchema: { type: "object" }, parse: (v) => v }, "sys", "usr"))
        .rejects.toMatchObject({ code: "AI_UPSTREAM", status: 503 });

      expect(createInteractionMock).toHaveBeenCalledTimes(2);
    });

    it("retries 429 with retry delay once and succeeds on second attempt", async () => {
      createInteractionMock
        .mockRejectedValueOnce({ status: 429, retryDelay: 50, message: "Rate limit reached" })
        .mockResolvedValueOnce({ output_text: JSON.stringify({ ok: true }) });

      const client = getAiClient();
      const result = await client.generateStructured(
        { jsonSchema: { type: "object" }, parse: (v) => v as { ok: boolean } },
        "sys",
        "usr",
      );

      expect(result).toEqual({ ok: true });
      expect(createInteractionMock).toHaveBeenCalledTimes(2);
    });

    it("never retries on auth errors (401/403)", async () => {
      createInteractionMock.mockRejectedValueOnce({ status: 401, message: "Unauthorized" });

      const client = getAiClient();
      await expect(client.generateStructured({ jsonSchema: { type: "object" }, parse: (v) => v }, "sys", "usr"))
        .rejects.toMatchObject({ code: "AI_AUTH", status: 401 });

      expect(createInteractionMock).toHaveBeenCalledTimes(1);
    });

    it("never retries on 404 model not found", async () => {
      createInteractionMock.mockRejectedValueOnce({ status: 404, message: "Not Found" });

      const client = getAiClient();
      await expect(client.generateStructured({ jsonSchema: { type: "object" }, parse: (v) => v }, "sys", "usr"))
        .rejects.toMatchObject({ code: "AI_MODEL_NOT_FOUND", status: 404 });

      expect(createInteractionMock).toHaveBeenCalledTimes(1);
    });

    it("never retries on 400 bad output / schema rejection", async () => {
      createInteractionMock.mockRejectedValueOnce({ status: 400, message: "Invalid argument" });

      const client = getAiClient();
      await expect(client.generateStructured({ jsonSchema: { type: "object" }, parse: (v) => v }, "sys", "usr"))
        .rejects.toMatchObject({ code: "AI_BAD_OUTPUT", status: 400 });

      expect(createInteractionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("guard safety invariants: AI error cannot APPROVE or loosen BLOCK", () => {
    const failureCodes = [
      "AI_NOT_CONFIGURED",
      "AI_AUTH",
      "AI_MODEL_NOT_FOUND",
      "AI_QUOTA",
      "AI_TIMEOUT",
      "AI_BAD_OUTPUT",
      "AI_UPSTREAM",
    ] as const;

    for (const code of failureCodes) {
      it(`turns ${code} failure into REVIEW with "AI check unavailable" and records code in audit`, async () => {
        const store = new MemoryStore();
        await store.createMandate({ ...mandate, familyId: "fam-1", hash: "hash-1" });

        const failingCheck = async () => {
          throw new AiUnavailableError(`Simulated ${code}`, { code });
        };

        const result = await evaluateProposal(
          store,
          mandate.mandateId,
          [{ productId: PRODUCTS[0]!.id, quantity: 1 }],
          "AGENT_LIVE",
          failingCheck,
        );

        // Invariant: verdict must be REVIEW, never APPROVE
        expect(result.decision.verdict).toBe("REVIEW");
        expect(result.decision.reasons).toContain("AI check unavailable");

        // Audit record must contain the failure code
        const events = await store.listAuditEvents();
        const evalEvent = events.find((e) => e.type === "CART_PROPOSAL_EVALUATED");
        expect(evalEvent).toBeDefined();
        const payload = evalEvent!.payload as { verdict: string; reasons: string[]; aiFailureCode?: string };
        expect(payload.verdict).toBe("REVIEW");
        expect(payload.reasons).toContain("AI check unavailable");
        expect(payload.aiFailureCode).toBe(code);
      });

      it(`never loosens a deterministic BLOCK on ${code} failure`, async () => {
        const failingCheck = async () => {
          throw new AiUnavailableError(`Simulated ${code}`, { code });
        };

        const decision = await evaluateCart(mandate, overbudgetCart, failingCheck);
        expect(decision.verdict).toBe("BLOCK");
        expect(decision.verdict).not.toBe("REVIEW");
        expect(decision.verdict).not.toBe("APPROVE");
      });
    }
  });

  describe("cache resilience", () => {
    it("uses cached semantic check before calling model", async () => {
      const store = new MemoryStore();
      const client = {
        getModelName: () => "test-model",
        generateStructured: vi.fn(),
        runToolCallingLoop: vi.fn(),
      };
      await store.setSemanticCheckCache(SEMANTIC_PROMPT_VERSION, "test-model", "test-mandate", "test-cart", {
        verdict: "APPROVE",
        reasons: ["Cached approval"],
      });

      // Populate cache with exact hashes for mandate & compliantCart
      const check = createSemanticCheck(store, client);
      // First call invokes model
      client.generateStructured.mockResolvedValueOnce({ verdict: "APPROVE", reasons: ["Fresh model result"] });
      const first = await check(mandate, compliantCart);
      expect(first.verdict).toBe("APPROVE");
      expect(client.generateStructured).toHaveBeenCalledTimes(1);

      // Second call uses cache without model invocation
      const second = await check(mandate, compliantCart);
      expect(second.verdict).toBe("APPROVE");
      expect(client.generateStructured).toHaveBeenCalledTimes(1);
    });

    it("proceeds to model call if cache lookup throws", async () => {
      const store = new MemoryStore();
      vi.spyOn(store, "getSemanticCheckCache").mockRejectedValueOnce(new Error("Cache read error"));
      const client = {
        getModelName: () => "test-model",
        generateStructured: vi.fn().mockResolvedValueOnce({ verdict: "APPROVE", reasons: ["Model result after cache error"] }),
        runToolCallingLoop: vi.fn(),
      };

      const check = createSemanticCheck(store, client);
      const result = await check(mandate, compliantCart);
      expect(result.verdict).toBe("APPROVE");
      expect(client.generateStructured).toHaveBeenCalledTimes(1);
    });

    it("does not break if cache write throws", async () => {
      const store = new MemoryStore();
      vi.spyOn(store, "setSemanticCheckCache").mockRejectedValueOnce(new Error("Cache write error"));
      const client = {
        getModelName: () => "test-model",
        generateStructured: vi.fn().mockResolvedValueOnce({ verdict: "APPROVE", reasons: ["Model result"] }),
        runToolCallingLoop: vi.fn(),
      };

      const check = createSemanticCheck(store, client);
      const result = await check(mandate, compliantCart);
      expect(result.verdict).toBe("APPROVE");
    });
  });

  describe("compile failure and scripted agent resilience", () => {
    it("never invents constraints when compileMandate fails", async () => {
      const failingClient = {
        getModelName: () => "test-model",
        generateStructured: vi.fn().mockRejectedValueOnce(new AiUnavailableError("Service down", { code: "AI_UPSTREAM" })),
        runToolCallingLoop: vi.fn(),
      };

      const { compileMandate } = await import("../../src/lib/ai/compile-mandate");
      await expect(compileMandate("Reorder paper under $50", "USD", failingClient))
        .rejects.toBeInstanceOf(AiUnavailableError);
    });

    it("allows scripted agent to run and produce review decisions even when Gemini is completely down", async () => {
      const store = new MemoryStore();
      await store.createMandate({ ...mandate, familyId: "fam-scripted", hash: "hash-scripted" });

      // Semantic check fails because Gemini is offline
      const offlineCheck = async () => {
        throw new AiUnavailableError("Gemini offline", { code: "AI_NOT_CONFIGURED" });
      };

      const { runScriptedAgent } = await import("../../src/lib/ai/scripted-agent");
      const scripted = runScriptedAgent("compliant");
      const result = await evaluateProposal(
        store,
        mandate.mandateId,
        scripted.cart.lineItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        "AGENT_SCRIPTED",
        offlineCheck,
      );

      // Invariant: Proposal succeeds in returning a decision to the manager
      expect(result.proposal).toBeDefined();
      expect(result.decision.verdict).toBe("REVIEW");
      expect(result.decision.reasons).toContain("AI check unavailable");

      // Can be retrieved from store
      const stored = await store.getDecision(result.decision.id);
      expect(stored?.verdict).toBe("REVIEW");
    });

    it("rejects an arbitrary code injected into model result and fails safely to REVIEW", async () => {
      const store = new MemoryStore();
      const client = {
        getModelName: () => "test-model",
        generateStructured: vi.fn().mockImplementation(async (schema: { parse: (v: unknown) => unknown }) => {
          return schema.parse({
            verdict: "APPROVE",
            reasons: ["Complies"],
            code: "ATTACKER_INJECTED_CODE",
          });
        }),
        runToolCallingLoop: vi.fn(),
      };

      const check = createSemanticCheck(store, client as unknown as import("../../src/lib/ai/client").AiClient);
      const decision = await evaluateCart(mandate, compliantCart, check);
      expect(decision.verdict).toBe("REVIEW");
      expect(decision.verdict).not.toBe("APPROVE");
      expect(decision.reasons).toContain("AI check unavailable");
      expect(decision.aiResult?.code).toBe("AI_BAD_OUTPUT");
    });
  });
});
