import { z } from "zod";
import { getAiClient, classifyAiError, AiUnavailableError, type AiFailureCode } from "@/lib/ai/client";
import { withAiBudget } from "@/lib/ai/budget";
import { logAiFailure } from "@/lib/ai/diagnostics";
import { runAgent } from "@/lib/ai/agent";
import { runScriptedAgent, type ScriptedCase } from "@/lib/ai/scripted-agent";
import { MandateSchema } from "@/lib/schemas/mandate";
import { evaluateProposal, unavailableSemanticCheck } from "@/lib/gateway/purchase";
import { InvalidJsonError, errorResponse, rateLimitResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({
  mode: z.enum(["scripted", "live"]),
  mandateId: z.uuid(),
  request: z.string().trim().max(1000).default("Reorder the paper described by my mandate."),
  scenario: z.enum(["compliant", "overbudget-premium", "mislabeled", "optional-injection"]).optional(),
}).strict();

function itemsOf(cart: { lineItems: { productId: string; quantity: number }[] }) {
  return cart.lineItems.map(({ productId, quantity }) => ({ productId, quantity }));
}

export async function POST(request: Request) {
  try {
    const input = await readJson(request, InputSchema);
    if (input.mode === "live") {
      const limited = rateLimitResponse(request);
      if (limited) return limited;
    }
    const store = getStore();
    const record = await store.getMandate(input.mandateId);
    if (!record || record.status !== "CONFIRMED") return errorResponse("Choose a persisted confirmed mandate", 400);
    const mandate = MandateSchema.parse(record);
    if (input.mode === "scripted") {
      const scripted = runScriptedAgent((input.scenario ?? "compliant") as ScriptedCase);
      const result = await evaluateProposal(store, mandate.mandateId, itemsOf(scripted.cart), "AGENT_SCRIPTED");
      return Response.json({ proposals: [{ ...result, rationale: scripted.rationale }], mode: "scripted" }, { headers: { "Cache-Control": "no-store" } });
    }

    const fallbackReview = async (aiFailureCode?: AiFailureCode) => {
      const fallback = runScriptedAgent("compliant");
      const evaluated = await evaluateProposal(store, mandate.mandateId, itemsOf(fallback.cart), "AGENT_SCRIPTED", unavailableSemanticCheck(aiFailureCode));
      return Response.json({
        proposals: [{ ...evaluated, rationale: fallback.rationale }],
        mode: "live", fallback: true, error: "AI check unavailable",
      }, {
        headers: {
          "Cache-Control": "no-store",
          ...(aiFailureCode ? { "x-ai-error-code": aiFailureCode } : {}),
        },
      });
    };

    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await withAiBudget((budget) => runAgent(mandate, input.request, getAiClient(), budget));
    } catch (error) {
      const failure = error instanceof AiUnavailableError ? error : classifyAiError(error);
      logAiFailure(error, failure.code, failure.status);
      return await fallbackReview(failure.code);
    }
    if (result.error || result.proposals.length === 0) {
      logAiFailure(new Error(result.error ?? "The live agent returned no proposals"), "AI_BAD_OUTPUT");
      return await fallbackReview("AI_BAD_OUTPUT");
    }

    const proposals = await Promise.all(result.proposals.map(async (item) => {
      const evaluated = await evaluateProposal(store, mandate.mandateId, itemsOf(item.cart), "AGENT_LIVE");
      return { ...evaluated, rationale: item.rationale };
    }));
    return Response.json({ proposals }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidJsonError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    return errorResponse("Agent run failed. Please try again.", 500);
  }
}
