import { z } from "zod";
import { completeCheckout } from "@/lib/gateway/purchase";
import { errorResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({ orderID: z.string().min(1).optional(), token: z.string().min(1).optional() }).strict()
  .refine((value) => Boolean(value.orderID || value.token), "PayPal order id is required");

export async function POST(request: Request) {
  try {
    const input = await readJson(request, InputSchema);
    const order = await completeCheckout(getStore(), input.orderID ?? input.token!);
    return Response.json(order, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid PayPal response", 400);
    return errorResponse(error instanceof Error ? error.message : "PayPal completion failed", 400);
  }
}
