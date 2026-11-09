import { TimeoutError } from "../timeout";

const RETRYABLE_SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

const RETRYABLE_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
]);

const RETRYABLE_ADAPTER_KINDS = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TlsConnectionError",
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "connection terminated",
  "connection timeout",
  "timeout exceeded when trying to connect",
  "timeout expired",
  "can't reach database server",
  "server has closed the connection",
  "connection reset",
  "socket hang up",
  "econnreset",
  "econnrefused",
  "etimedout",
];

function matchesConnectionErrorNode(error: unknown, seen: Set<unknown>, depth: number): boolean {
  if (!error || typeof error !== "object" || depth > 4 || seen.has(error)) return false;
  if (error instanceof TimeoutError) return false;
  seen.add(error);

  const value = error as { code?: unknown; kind?: unknown; message?: unknown; cause?: unknown };
  if (typeof value.code === "string") {
    const code = value.code.toUpperCase();
    if (RETRYABLE_SOCKET_CODES.has(code) || RETRYABLE_PRISMA_CODES.has(code)) {
      return true;
    }
  }
  if (typeof value.kind === "string" && RETRYABLE_ADAPTER_KINDS.has(value.kind)) {
    return true;
  }
  if (typeof value.message === "string") {
    const message = value.message.toLowerCase();
    if (RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
      return true;
    }
  }
  return value.cause !== undefined && matchesConnectionErrorNode(value.cause, seen, depth + 1);
}

export function isDbConnectionError(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  return matchesConnectionErrorNode(error, new Set<unknown>(), 0);
}

export interface DbReadRetryOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
}

export async function retryOnceOnDbConnectionError<T>(
  operation: () => Promise<T>,
  options?: DbReadRetryOptions,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isDbConnectionError(error)) throw error;
    if (options?.signal?.aborted) throw error;
    if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) throw error;
    return await operation();
  }
}

