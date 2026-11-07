import { getStore } from "@/lib/runtime";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    return Response.json(await getStore().listAuditEvents(), { headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse("Could not load audit events", 503); }
}
