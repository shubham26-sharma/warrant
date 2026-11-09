import { z } from "zod";
import { PayPalUnavailableError } from "@/lib/errors";
import { OrderAuthorizationError } from "@/lib/gateway/authorize";
import { PurchaseFlowError, startCheckout } from "@/lib/gateway/purchase";
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
    if (error instanceof OrderAuthorizationError) return errorResponse(error.message, 403);
    if (error instanceof PurchaseFlowError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse("Decision failed authorization checks", 403);
    if (error instanceof PayPalUnavailableError) {
      return errorResponse("PayPal Sandbox is temporarily unavailable. Please try again.", 502);
    }
    return errorResponse("Checkout could not start. Please try again.", 503);
  }
}
