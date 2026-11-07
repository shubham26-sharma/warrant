export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterMs: number }
export interface RateLimiterOptions { capacity: number; refillPerSecond: number }

export function createRateLimiter({ capacity, refillPerSecond }: RateLimiterOptions) {
  if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new RangeError("Rate limiter capacity and refill rate must be positive");
  }
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  return {
    consume(ip: string, now = Date.now()): RateLimitResult {
      const bucket = buckets.get(ip) ?? { tokens: capacity, updatedAt: now };
      const elapsed = Math.max(0, now - bucket.updatedAt);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond / 1000);
      bucket.updatedAt = now;
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(ip, bucket);
      const retryAfterMs = allowed ? 0 : Math.ceil((1 - bucket.tokens) * 1000 / refillPerSecond);
      return { allowed, remaining: Math.floor(bucket.tokens), retryAfterMs };
    },
  };
}
