export const DATABASE_CONNECT_TIMEOUT_MS = 4000;
export const DATABASE_OPERATION_TIMEOUT_MS = 5000;
export const PAYPAL_REQUEST_TIMEOUT_MS = 8000;

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

