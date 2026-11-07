import { z } from "zod";
import { compileMandate } from "@/lib/ai/compile-mandate";
import { AiUnavailableError } from "@/lib/ai/client";
import { errorResponse, rateLimitResponse, readJson } from "@/lib/http";

const InputSchema = z.object({ text: z.string().trim().min(1).max(1000), currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD") }).strict();

export async function POST(request: Request) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  try {
    const input = await readJson(request, InputSchema);
    const mandate = await compileMandate(input.text, input.currency);
    return Response.json(mandate, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AiUnavailableError) return errorResponse("AI check unavailable", 503);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid mandate request", 400);
    return errorResponse(error instanceof Error ? error.message : "Mandate compilation failed", 400);
  }
}
