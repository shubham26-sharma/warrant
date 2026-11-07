import { z } from "zod";
import { approveReview } from "@/lib/gateway/purchase";
import { errorResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

export async function POST(request: Request, context: RouteContext<"/api/purchases/[decisionId]/approve-review">) {
  try {
    const { decisionId } = await context.params;
    const { note } = await readJson(request, InputSchema);
    return Response.json(await approveReview(getStore(), decisionId, note), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Approval note is required", 400);
    return errorResponse(error instanceof Error ? error.message : "Approval failed", 400);
  }
}
