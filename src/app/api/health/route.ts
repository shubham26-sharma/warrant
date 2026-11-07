import { connection } from "next/server";
import { getPrismaClient } from "@/lib/db/prisma";

export async function GET() {
  await connection();
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "connected" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
