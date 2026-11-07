import { verifyChain } from "@/lib/audit/chain";
import { getStore } from "@/lib/runtime";
import { errorResponse } from "@/lib/http";

export async function POST() {
  try { return Response.json(await verifyChain(getStore()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return errorResponse("Could not verify audit chain", 503); }
}
