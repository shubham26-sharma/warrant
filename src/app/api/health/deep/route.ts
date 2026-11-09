import { getPrismaClient } from "@/lib/db/prisma";
import { getDeepHealthConfig } from "@/lib/env-config";
import { DATABASE_HEALTH_TIMEOUT_MS } from "@/lib/health";
import { withTimeout } from "@/lib/timeout";

export async function GET() {
  const config = getDeepHealthConfig();
  try {
    await withTimeout(getPrismaClient().$queryRaw`SELECT 1`, DATABASE_HEALTH_TIMEOUT_MS, "database health check timed out");
    return Response.json({ status: "ok", database: "connected", config }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", database: "unavailable", config }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
