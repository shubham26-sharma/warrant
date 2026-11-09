import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../hash";
import type { Cart } from "../schemas/cart";
import { AiResultSchema, DecisionSchema, type AiResult, type Decision, type Verdict } from "../schemas/decision";
import type { Mandate } from "../schemas/mandate";
import { combine } from "./combine";
import { deterministicVerdict, evaluateDeterministicRules } from "./rules";
import { withAiBudget, type AiBudgetContext } from "../ai/budget";
import { classifyAiError, AiUnavailableError } from "../ai/client";

export type SemanticCheck = (mandate: Mandate, cart: Cart, budget?: AiBudgetContext) => Promise<unknown>;

export class MandateNotConfirmedError extends Error {
  constructor() {
    super("The mandate must be confirmed before a cart can be evaluated");
    this.name = "MandateNotConfirmedError";
  }
}

function unavailableAiResult(code?: string): AiResult {
  return { verdict: "REVIEW", reasons: ["AI check unavailable"], ...(code ? { code } : {}) };
}

export async function evaluateCart(mandate: Mandate, cart: Cart, semanticCheck: SemanticCheck): Promise<Decision> {
  if (mandate.status !== "CONFIRMED") throw new MandateNotConfirmedError();

  const ruleResults = evaluateDeterministicRules(mandate, cart);
  const deterministic = deterministicVerdict(ruleResults);
  let aiResult: AiResult | null = null;
  let finalVerdict: Verdict = deterministic;

  if (deterministic !== "BLOCK") {
    try {
      const rawAiResult = await withAiBudget((budget) => semanticCheck(mandate, cart, budget));
      const parsedAiResult = AiResultSchema.safeParse(rawAiResult);
      aiResult = parsedAiResult.success ? parsedAiResult.data : unavailableAiResult("AI_BAD_OUTPUT");
    } catch (error) {
      const code = error instanceof AiUnavailableError ? error.code : classifyAiError(error).code;
      aiResult = unavailableAiResult(code);
    }
    finalVerdict = combine(deterministic, aiResult.verdict);
  }

  const reasons = [
    ...ruleResults.filter((rule) => !rule.passed).map(({ message }) => message),
    ...(aiResult?.reasons ?? []),
  ];

  return DecisionSchema.parse({
    decisionId: randomUUID(),
    mandateHash: sha256Hex(canonicalJson(mandate)),
    cartHash: sha256Hex(canonicalJson(cart)),
    verdict: finalVerdict,
    ruleResults,
    aiResult,
    reasons,
    createdAt: new Date().toISOString(),
  });
}
