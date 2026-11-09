import { z } from "zod";
import { PayPalUnavailableError } from "@/lib/errors";
import { PurchaseFlowError, completeCheckout } from "@/lib/gateway/purchase";
import { InvalidJsonError, errorResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({ orderID: z.string().min(1).optional(), token: z.string().min(1).optional() }).strict()
  .refine((value) => Boolean(value.orderID || value.token), "PayPal order id is required");

export async function POST(request: Request) {
  try {
    const input = await readJson(request, InputSchema);
    const order = await completeCheckout(getStore(), input.orderID ?? input.token!);
    return Response.json(order, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidJsonError) return errorResponse(error.message, 400);
    if (error instanceof PurchaseFlowError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid PayPal response", 400);
    if (error instanceof PayPalUnavailableError) {
      return errorResponse("PayPal Sandbox is temporarily unavailable. Please try again.", 502);
    }
    return errorResponse("Could not complete PayPal checkout. Please try again.", 503);
  }
}
