import { getPrismaClient } from "@/lib/db/prisma";
import { retryOnceOnDbConnectionError } from "@/lib/db/retry";
import { getDeepHealthConfig } from "@/lib/env-config";
import { DATABASE_HEALTH_TIMEOUT_MS } from "@/lib/health";
import { runWithTimeout } from "@/lib/timeout";

export async function GET() {
  const config = getDeepHealthConfig();
  try {
    await runWithTimeout(
      ({ signal, deadlineAt }) =>
        retryOnceOnDbConnectionError(() => getPrismaClient().$queryRaw`SELECT 1`, { signal, deadlineAt }),
      DATABASE_HEALTH_TIMEOUT_MS,
      "database health check timed out",
    );
    return Response.json({ status: "ok", database: "connected", config }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", database: "unavailable", config }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
