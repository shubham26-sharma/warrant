import { createRateLimiter } from "./ai/rate-limiter";

const modelRouteLimiter = createRateLimiter({ capacity: 8, refillPerSecond: 0.2 });

export function consumeModelRouteToken(ip: string) { return modelRouteLimiter.consume(ip); }
