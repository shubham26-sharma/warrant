import { z } from "zod";
import { consumeModelRouteToken } from "./rate-limit";

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new Error("Request body must be valid JSON"); }
  return schema.parse(value);
}

export function rateLimitResponse(request: Request): Response | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const result = consumeModelRouteToken(ip);
  if (result.allowed) return null;
  return Response.json({ error: "Rate limit exceeded" }, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
  });
}
