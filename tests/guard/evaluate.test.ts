import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import { CartSchema } from "../../src/lib/schemas/cart";
import type { SemanticCheck } from "../../src/lib/guard/evaluate";
import { evaluateCart, MandateNotConfirmedError } from "../../src/lib/guard/evaluate";

const mandate = MandateSchema.parse(fixture.baseMandate);
const guardScenarios = fixture.scenarios.filter((scenario) => scenario.expectedStage === "guard");
const alwaysApprove: SemanticCheck = async () => ({ verdict: "APPROVE", reasons: [] });
const alwaysBlock: SemanticCheck = async () => ({ verdict: "BLOCK", reasons: ["Semantic check blocked the cart"] });

describe("evaluateCart", () => {
  it("matches every guard-stage fixture using an always-approve semantic check", async () => {
    const produced: string[] = [];
    for (const scenario of guardScenarios) {
      const cart = CartSchema.parse(scenario.cart);
      const decision = await evaluateCart(mandate, cart, alwaysApprove);
      expect(decision.verdict, scenario.id).toBe(scenario.expected);
      produced.push(`${scenario.id}: ${decision.verdict}`);
    }
    console.log(`Guard scenario verdicts\n${produced.join("\n")}`);
  });

  it("never approves a fixture whose expected verdict is BLOCK", async () => {
    const blocked = guardScenarios.filter((scenario) => scenario.expected === "BLOCK");
    for (const scenario of blocked) {
      const decision = await evaluateCart(mandate, CartSchema.parse(scenario.cart), alwaysApprove);
      expect(decision.verdict, scenario.id).toBe("BLOCK");
    }
  });

  it("lets a BLOCK semantic check tighten every fixture and never lower a deterministic result", async () => {
    for (const scenario of guardScenarios) {
      const decision = await evaluateCart(mandate, CartSchema.parse(scenario.cart), alwaysBlock);
      expect(decision.verdict, scenario.id).toBe("BLOCK");
    }
  });

  it("turns semantic-check failures and invalid output into REVIEW", async () => {
    const compliant = CartSchema.parse(guardScenarios.find((scenario) => scenario.id === "C01")?.cart);
    const throwing: SemanticCheck = async () => { throw new Error("offline"); };
    const invalid: SemanticCheck = async () => ({ verdict: "UNKNOWN", reasons: [] });

    const failedDecision = await evaluateCart(mandate, compliant, throwing);
    expect(failedDecision.verdict).toBe("REVIEW");
    expect(failedDecision.reasons).toContain("AI check unavailable");
    const invalidDecision = await evaluateCart(mandate, compliant, invalid);
    expect(invalidDecision.verdict).toBe("REVIEW");
    expect(invalidDecision.reasons).toContain("AI check unavailable");
  });

  it("turns a semantic timeout into a persisted-safe REVIEW, never APPROVE", async () => {
    vi.stubEnv("AI_TIMEOUT_MS", "5");
    try {
      const compliant = CartSchema.parse(guardScenarios.find((scenario) => scenario.id === "C01")?.cart);
      const timeout: SemanticCheck = async (_mandate, _cart, budget) => new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("simulated semantic request timeout")), 1_000);
        budget?.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("simulated semantic request timeout"));
        }, { once: true });
      });
      const decision = await evaluateCart(mandate, compliant, timeout);
      expect(decision.verdict).toBe("REVIEW");
      expect(decision.verdict).not.toBe("APPROVE");
      expect(decision.reasons).toContain("AI check unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("blocks inconsistent cart arithmetic without calling the semantic check", async () => {
    const compliant = CartSchema.parse(guardScenarios.find((scenario) => scenario.id === "C01")?.cart);
    const inconsistent = { ...compliant, totalCents: compliant.totalCents + 1 };
    const semanticCheck = vi.fn(alwaysApprove);
    const decision = await evaluateCart(mandate, inconsistent, semanticCheck);
    expect(decision.verdict).toBe("BLOCK");
    expect(semanticCheck).not.toHaveBeenCalled();
  });

  it("approves the exact maximum and blocks one cent over while arithmetic stays consistent", async () => {
    const exact = CartSchema.parse(guardScenarios.find((scenario) => scenario.id === "C03")?.cart);
    expect(exact.totalCents).toBe(mandate.hardConstraints.maximumTotalCents);
    expect((await evaluateCart(mandate, exact, alwaysApprove)).verdict).toBe("APPROVE");

    const oneCentOver = {
      ...exact,
      shippingCents: exact.shippingCents + 1,
      totalCents: exact.totalCents + 1,
    };
    expect((await evaluateCart(mandate, oneCentOver, alwaysApprove)).verdict).toBe("BLOCK");
  });

  it("refuses an unconfirmed mandate", async () => {
    const draft = MandateSchema.parse({ ...fixture.baseMandate, status: "DRAFT", confirmedAt: null });
    const compliant = CartSchema.parse(guardScenarios.find((scenario) => scenario.id === "C01")?.cart);
    await expect(evaluateCart(draft, compliant, alwaysApprove)).rejects.toBeInstanceOf(MandateNotConfirmedError);
  });
});
