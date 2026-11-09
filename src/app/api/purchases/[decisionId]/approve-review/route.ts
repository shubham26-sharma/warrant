import { z } from "zod";
import { PurchaseFlowError, approveReview } from "@/lib/gateway/purchase";
import { InvalidJsonError, errorResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

export async function POST(request: Request, context: RouteContext<"/api/purchases/[decisionId]/approve-review">) {
  try {
    const { decisionId } = await context.params;
    const { note } = await readJson(request, InputSchema);
    return Response.json(await approveReview(getStore(), decisionId, note), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidJsonError) return errorResponse(error.message, 400);
    if (error instanceof PurchaseFlowError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Approval note is required", 400);
    return errorResponse("Approval failed", 503);
  }
}
