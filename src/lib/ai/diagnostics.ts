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

export function logAiFailure(error: unknown): void {
  const details = safeAiErrorDetails(error);
  console.warn(`[Gemini] ${details.type}: ${details.message}`);
}
