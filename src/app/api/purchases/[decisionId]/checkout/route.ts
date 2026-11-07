import { z } from "zod";
import { startCheckout } from "@/lib/gateway/purchase";
import { getAppBaseUrl, getStore } from "@/lib/runtime";
import { errorResponse } from "@/lib/http";

export async function POST(_request: Request, context: RouteContext<"/api/purchases/[decisionId]/checkout">) {
  try {
    const { decisionId } = await context.params;
    const base = getAppBaseUrl();
    const order = await startCheckout(getStore(), decisionId, {
      returnUrl: `${base}/paypal/return`, cancelUrl: `${base}/paypal/cancel`,
    });
    return Response.json(order, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Decision failed authorization checks", 403);
    return errorResponse(error instanceof Error ? error.message : "Checkout could not start", 400);
  }
}
