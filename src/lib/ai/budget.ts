import { logAiFailure } from "./diagnostics";

export type AiBudgetContext = { signal: AbortSignal; timeoutMs: number };

export class AiBudgetExceededError extends Error {
  constructor(timeoutMs: number) {
    super(`AI operation exceeded its ${timeoutMs}ms time budget`);
    this.name = "AiBudgetExceededError";
  }
}

const DEFAULT_AI_TIMEOUT_MS = 15_000;
const MAX_AI_TIMEOUT_MS = 120_000;

export function getAiTimeoutMs(): number {
  const configured = process.env.AI_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_AI_TIMEOUT_MS;
  if (!/^\d+$/.test(configured)) throw new TypeError("AI_TIMEOUT_MS must be an integer between 1 and 120000");
  const timeoutMs = Number(configured);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_AI_TIMEOUT_MS) {
    throw new TypeError("AI_TIMEOUT_MS must be an integer between 1 and 120000");
  }
  return timeoutMs;
}

export async function withAiBudget<T>(
  operation: (context: AiBudgetContext) => Promise<T>,
  timeoutMs = getAiTimeoutMs(),
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => operation({ signal: controller.signal, timeoutMs }));
  // Prevent late rejections on an aborted operation from crashing the process after timeout wins.
  work.catch(() => undefined);
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new AiBudgetExceededError(timeoutMs);
      logAiFailure(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
