import { z } from "zod";
import { MandateConfirmationError, confirmMandate } from "@/lib/mandates/confirm-mandate";
import { MandateSchema } from "@/lib/schemas/mandate";
import { appendEvent } from "@/lib/audit/chain";
import { InvalidJsonError, errorResponse, readJson } from "@/lib/http";
import { getStore } from "@/lib/runtime";

const InputSchema = z.object({
  draft: MandateSchema.optional(),
  previousMandateId: z.uuid().optional(),
  edits: z.object({
    originalText: z.string().optional(), currency: z.string().optional(),
    hardConstraints: MandateSchema.shape.hardConstraints.optional(),
    softConstraints: MandateSchema.shape.softConstraints.optional(),
    ambiguity: MandateSchema.shape.ambiguity.optional(),
  }).strict().optional(),
}).strict();

export async function GET() {
  try { return Response.json(await getStore().listMandates(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return errorResponse("Could not load mandates", 503); }
}

export async function POST(request: Request) {
  try {
    const input = await readJson(request, InputSchema);
    const store = getStore();
    const prior = input.previousMandateId ? await store.getMandate(input.previousMandateId) : null;
    if (input.previousMandateId && (!prior || prior.status !== "CONFIRMED")) return errorResponse("Confirmed mandate version not found", 404);
    const source = prior ?? input.draft;
    if (!source) return errorResponse("A draft mandate or previous mandate id is required", 400);
    const confirmed = confirmMandate(source, input.edits ?? {});
    const saved = await store.createMandate(confirmed);
    await appendEvent(store, prior ? "MANDATE_VERSION_CREATED" : "MANDATE_CONFIRMED", {
      mandateId: saved.mandateId, familyId: saved.familyId, version: saved.version, hash: saved.hash,
    });
    return Response.json(saved, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidJsonError) return errorResponse(error.message, 400);
    if (error instanceof MandateConfirmationError) return errorResponse(error.message, 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Invalid mandate", 400);
    return errorResponse("Could not confirm mandate", 503);
  }
}
