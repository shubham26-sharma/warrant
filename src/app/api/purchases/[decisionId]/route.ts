import { getStore } from "@/lib/runtime";
import { errorResponse } from "@/lib/http";

export async function GET(_request: Request, context: RouteContext<"/api/purchases/[decisionId]">) {
  try {
    const { decisionId } = await context.params;
    const store = getStore();
    const decision = await store.getDecision(decisionId);
    if (!decision) return errorResponse("Decision not found", 404);
    const proposal = await store.getCartProposal(decision.cartProposalId);
    const mandate = proposal ? await store.getMandate(proposal.mandateId) : null;
    const approval = await store.getHumanApprovalByDecision(decisionId);
    const order = await store.getPayPalOrderByDecision(decisionId);
    return Response.json({ decision, proposal, mandate, approval, order }, { headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse("Could not load purchase", 503); }
}
