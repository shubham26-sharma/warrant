import { z } from "zod";
import { compileMandate } from "@/lib/ai/compile-mandate";
import { AiUnavailableError, classifyAiError } from "@/lib/ai/client";
import { logAiFailure } from "@/lib/ai/diagnostics";
import { InvalidJsonError, errorResponse, rateLimitResponse, readJson } from "@/lib/http";

const InputSchema = z.object({ text: z.string().trim().min(1).max(1000), currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD") }).strict();

export async function POST(request: Request) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  try {
    const input = await readJson(request, InputSchema);
    const mandate = await compileMandate(input.text, input.currency);
    return Response.json(mandate, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidJsonError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid mandate request", 400);
    const failure = error instanceof AiUnavailableError ? error : classifyAiError(error);
    logAiFailure(error, failure.code, failure.status);
    return Response.json(
      { error: "AI check unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "x-ai-error-code": failure.code,
        },
      },
    );
  }
}
