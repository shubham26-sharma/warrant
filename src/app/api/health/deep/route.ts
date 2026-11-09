import { getPrismaClient } from "@/lib/db/prisma";
import { getDeepHealthConfig } from "@/lib/env-config";
import { DATABASE_HEALTH_TIMEOUT_MS } from "@/lib/health";

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("database health check timed out")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const config = getDeepHealthConfig();
  try {
    await withTimeout(getPrismaClient().$queryRaw`SELECT 1`, DATABASE_HEALTH_TIMEOUT_MS);
    return Response.json({ status: "ok", database: "connected", config }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", database: "unavailable", config }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
