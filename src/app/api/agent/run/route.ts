import { z } from "zod";
import { AiUnavailableError } from "@/lib/ai/client";
import { runAgent } from "@/lib/ai/agent";
import { runScriptedAgent, type ScriptedCase } from "@/lib/ai/scripted-agent";
import { MandateSchema } from "@/lib/schemas/mandate";
import { evaluateProposal, unavailableSemanticCheck } from "@/lib/gateway/purchase";
import { errorResponse, rateLimitResponse, readJson } from "@/lib/http";
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

    try {
      const result = await runAgent(mandate, input.request);
      const proposals = [];
      for (const item of result.proposals) {
        const evaluated = await evaluateProposal(store, mandate.mandateId, itemsOf(item.cart), "AGENT_LIVE");
        proposals.push({ ...evaluated, rationale: item.rationale });
      }
      return Response.json({ proposals, error: result.error }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      const fallback = runScriptedAgent("compliant");
      const evaluated = await evaluateProposal(store, mandate.mandateId, itemsOf(fallback.cart), "AGENT_SCRIPTED", unavailableSemanticCheck());
      return Response.json({
        proposals: [{ ...evaluated, rationale: fallback.rationale }],
        mode: "live", fallback: true, error: "AI check unavailable",
      }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    return errorResponse(error instanceof Error ? error.message : "Agent run failed", 500);
  }
}
