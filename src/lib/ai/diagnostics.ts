import { classifyAiError, type AiFailureCode, AiUnavailableError } from "./client";

export function safeAiErrorDetails(error: unknown): { type: string; message: string } {
  const value = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : {};
  const type = typeof value.name === "string" ? value.name.slice(0, 100) : "UnknownError";
  let message = typeof value.message === "string" ? value.message : String(error);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey) message = message.split(apiKey).join("[REDACTED]");
  message = message
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return { type, message };
}

export function logAiFailure(error: unknown, failureCode?: AiFailureCode, status?: number): void {
  let code = failureCode;
  let st = status;
  if (!code && error instanceof AiUnavailableError) {
    code = error.code;
    st = error.status ?? st;
  }
  if (!code) {
    const classified = classifyAiError(error);
    code = classified.code;
    st = classified.status ?? st;
  }
  console.warn(`[Gemini] ${code}${st ? ` (${st})` : ""}`);
}
