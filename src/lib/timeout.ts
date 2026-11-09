import { z } from "zod";

export const DB_TIMEOUT_MIN_MS = 1000;
export const DB_TIMEOUT_MAX_MS = 60_000;
export const DEFAULT_DB_CONNECT_TIMEOUT_MS = 15_000;
export const DEFAULT_DB_QUERY_TIMEOUT_MS = 15_000;
export const PAYPAL_REQUEST_TIMEOUT_MS = 8000;

export const DbTimeoutEnvSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .pipe(z.number().int().min(DB_TIMEOUT_MIN_MS).max(DB_TIMEOUT_MAX_MS));

export type DbTimeoutEnvName = "DB_CONNECT_TIMEOUT_MS" | "DB_QUERY_TIMEOUT_MS";

export function parseDbTimeoutEnv(
  name: DbTimeoutEnvName,
  defaultMs: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  if (!raw) return defaultMs;
  const parsed = DbTimeoutEnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TypeError(`${name} must be an integer between ${DB_TIMEOUT_MIN_MS} and ${DB_TIMEOUT_MAX_MS}`);
  }
  return parsed.data;
}

export function getDbConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseDbTimeoutEnv("DB_CONNECT_TIMEOUT_MS", DEFAULT_DB_CONNECT_TIMEOUT_MS, env);
}

export function getDbQueryTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseDbTimeoutEnv("DB_QUERY_TIMEOUT_MS", DEFAULT_DB_QUERY_TIMEOUT_MS, env);
}

export function getDbStoreTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return getDbConnectTimeoutMs(env) + getDbQueryTimeoutMs(env);
}

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Attach a no-op rejection handler so timed-out operations that fail later never crash the process.
  operation.catch(() => undefined);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runWithTimeout<T>(
  operation: (context: { signal: AbortSignal; deadlineAt: number }) => Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => operation({ signal: controller.signal, deadlineAt }));
  // Attach a no-op rejection handler so timed-out operations that fail later never crash the process.
  work.catch(() => undefined);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

