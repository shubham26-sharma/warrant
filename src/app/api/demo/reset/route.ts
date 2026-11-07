import { seedSampleMandate } from "@/lib/mandates/sample";
import { appendEvent } from "@/lib/audit/chain";
import { getStore } from "@/lib/runtime";
import { errorResponse } from "@/lib/http";

export async function POST() {
  if (process.env.DEMO_RESET_ENABLED !== "true") return errorResponse("Demo reset is disabled", 404);
  try {
    const store = getStore();
    await store.clearDemoData();
    const mandate = await seedSampleMandate(store);
    await appendEvent(store, "DEMO_RESET", { mandateId: mandate.mandateId, version: mandate.version });
    return Response.json({ ok: true, mandate }, { headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse("Demo reset failed", 503); }
}
