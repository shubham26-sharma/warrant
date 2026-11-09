import { GoogleGenAI, type Interactions } from "@google/genai";
import { getAiTimeoutMs, type AiBudgetContext } from "./budget";
import { logAiFailure } from "./diagnostics";

export interface JsonSchema {
  type: string;
  [key: string]: unknown;
}

export interface StructuredOutputSchema<T> {
  jsonSchema: JsonSchema;
  parse(value: unknown): T;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCallRecord {
  name: string;
  arguments: unknown;
}

export interface ToolLoopOptions {
  system: string;
  user: string;
  tools: readonly AiToolDefinition[];
  maxSteps: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  executeTool(name: string, argumentsValue: unknown): Promise<unknown>;
}

export type AiRequestOptions = Pick<AiBudgetContext, "signal" | "timeoutMs">;

export interface ToolLoopResult {
  toolCalls: ToolCallRecord[];
  outputText: string | null;
  error?: string;
}

export interface AiClient {
  getModelName(): string;
  generateStructured<T>(schema: StructuredOutputSchema<T>, system: string, user: string, options?: AiRequestOptions): Promise<T>;
  runToolCallingLoop(options: ToolLoopOptions): Promise<ToolLoopResult>;
}

import { type AiFailureCode, AI_FAILURE_CODES } from "../schemas/decision";
export { type AiFailureCode, AI_FAILURE_CODES };

export class AiUnavailableError extends Error {
  readonly code: AiFailureCode;
  readonly status?: number;

  constructor(
    message = "Gemini is unavailable",
    options?: ErrorOptions & { code?: AiFailureCode; status?: number },
  ) {
    super(message, options);
    this.name = "AiUnavailableError";
    this.code = options?.code ?? "AI_UPSTREAM";
    this.status = options?.status;
  }
}

const MAX_RETRIES = 1;

type GeminiRuntime = { client: GoogleGenAI; model: string };

function unavailable(
  message: string,
  cause: unknown,
  code?: AiFailureCode,
  status?: number,
): AiUnavailableError {
  const classified = code ? { code, status } : classifyAiError(cause);
  logAiFailure(cause, classified.code, classified.status);
  return new AiUnavailableError(message, {
    cause,
    code: classified.code,
    status: classified.status,
  });
}

function createGeminiRuntime(): GeminiRuntime {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) {
    throw unavailable(
      "GEMINI_API_KEY and GEMINI_MODEL must be configured",
      new Error("AI credentials missing"),
      "AI_NOT_CONFIGURED",
    );
  }
  try {
    return { client: new GoogleGenAI({ apiKey }), model };
  } catch (error) {
    throw unavailable("Gemini client could not be initialized", error, "AI_NOT_CONFIGURED");
  }
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown } };
  if (typeof value.status === "number") return value.status;
  if (typeof value.status === "string" && /^\d+$/.test(value.status)) return Number(value.status);
  if (typeof value.statusCode === "number") return value.statusCode;
  if (typeof value.statusCode === "string" && /^\d+$/.test(value.statusCode)) return Number(value.statusCode);
  if (typeof value.response?.status === "number") return value.response.status;
  if (typeof value.code === "number") return value.code;
  return undefined;
}

function isAbortOrTimeout(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  if (name === "zoderror" || name === "syntaxerror") return false;
  const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  return name.includes("abort") || name.includes("timeout") ||
    message.includes("aborted") || message.includes("timeout") || message.includes("timed out") ||
    code === "ABORT_ERR" || code === "ETIMEDOUT";
}

export function classifyAiError(error: unknown, signal?: AbortSignal): { code: AiFailureCode; status?: number } {
  if (error instanceof AiUnavailableError) {
    return { code: error.code, status: error.status };
  }
  if (error && typeof error === "object") {
    const errObj = error as { name?: unknown; message?: unknown };
    if (errObj.name === "ZodError" || errObj.name === "SyntaxError") {
      return { code: "AI_BAD_OUTPUT" };
    }
    if (errObj.name === "AiBudgetExceededError") {
      return { code: "AI_TIMEOUT" };
    }
    const msg = typeof errObj.message === "string" ? errObj.message : "";
    if (msg.includes("AI_TIMEOUT_MS must be an integer")) {
      return { code: "AI_NOT_CONFIGURED" };
    }
  }
  if (signal?.aborted || isAbortOrTimeout(error, signal)) {
    return { code: "AI_TIMEOUT" };
  }

  const status = getStatus(error);
  if (status === 401 || status === 403) {
    return { code: "AI_AUTH", status };
  }
  if (status === 404) {
    return { code: "AI_MODEL_NOT_FOUND", status };
  }
  if (status === 429) {
    return { code: "AI_QUOTA", status };
  }
  if (status === 400) {
    return { code: "AI_BAD_OUTPUT", status };
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return { code: "AI_UPSTREAM", status };
  }

  if (error && typeof error === "object") {
    const errObj = error as { message?: unknown; code?: unknown };
    const msg = (typeof errObj.message === "string" ? errObj.message : "").toLowerCase();
    const codeStr = (typeof errObj.code === "string" ? errObj.code : "").toUpperCase();

    if (codeStr === "ECONNRESET" || codeStr === "EAI_AGAIN" || codeStr === "ECONNREFUSED" || codeStr === "ENOTFOUND") {
      return { code: "AI_UPSTREAM" };
    }
    if (msg.includes("api_key") || msg.includes("api key") || msg.includes("unauthenticated") || msg.includes("permission_denied") || msg.includes("forbidden")) {
      return { code: "AI_AUTH" };
    }
    if (msg.includes("not found") || msg.includes("models/")) {
      return { code: "AI_MODEL_NOT_FOUND" };
    }
    if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource_exhausted") || msg.includes("too many requests")) {
      return { code: "AI_QUOTA", status: 429 };
    }
    if (msg.includes("must be configured") || msg.includes("gemini_api_key") || msg.includes("gemini_model")) {
      return { code: "AI_NOT_CONFIGURED" };
    }
    if (msg.includes("json") || msg.includes("schema") || msg.includes("invalid output") || msg.includes("tool loop") || msg.includes("unknown tool")) {
      return { code: "AI_BAD_OUTPUT" };
    }
  }

  return { code: "AI_UPSTREAM", status };
}

function getRetryDelayMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const val = error as Record<string, unknown>;
  const headers = (val.response as { headers?: unknown })?.headers || val.headers;
  let retryAfter: string | undefined | null;
  if (headers && typeof (headers as Headers).get === "function") {
    retryAfter = (headers as Headers).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const rec = headers as Record<string, string>;
    retryAfter = rec["retry-after"] || rec["Retry-After"];
  }
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }
  if (typeof val.retryDelay === "number" && val.retryDelay >= 0) {
    return val.retryDelay;
  }
  if (typeof val.message === "string") {
    const match = /retry\s+after\s+(\d+(?:\.\d+)?)\s*s/i.exec(val.message);
    if (match) {
      return Math.round(Number(match[1]) * 1000);
    }
  }
  return null;
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || delayMs <= 0) return false;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(!signal?.aborted);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withProviderRetry<T>(
  operation: (remainingMs: number) => Promise<T>,
  options: { signal?: AbortSignal; deadlineAt: number },
): Promise<T> {
  const { signal, deadlineAt } = options;
  for (let attempt = 0; ; attempt += 1) {
    const remainingMs = deadlineAt - Date.now();
    if (signal?.aborted || remainingMs <= 0) {
      throw unavailable("Gemini request timed out", new Error("AI request exceeded its time budget"), "AI_TIMEOUT");
    }
    try {
      return await operation(Math.max(1, remainingMs));
    } catch (error) {
      const remainingAfterAttempt = deadlineAt - Date.now();
      const { code, status } = classifyAiError(error, signal);

      // Retry policy: retry once only for 429-with-retry-delay and 5xx; never retry on timeout, auth, 404 or bad-output.
      if (attempt < MAX_RETRIES && !signal?.aborted && remainingAfterAttempt > 200) {
        if (code === "AI_QUOTA") {
          const parsedDelay = getRetryDelayMs(error);
          const delayMs = parsedDelay !== null ? parsedDelay : 500;
          if (delayMs > 0 && remainingAfterAttempt > delayMs + 100) {
            const shouldRetry = await waitForRetry(delayMs, signal);
            if (shouldRetry) continue;
          }
        } else if (code === "AI_UPSTREAM" && (status === undefined || (status >= 500 && status < 600))) {
          const delayMs = 100;
          if (remainingAfterAttempt > delayMs + 100) {
            const shouldRetry = await waitForRetry(delayMs, signal);
            if (shouldRetry) continue;
          }
        }
      }
      throw unavailable("Gemini request failed", error, code, status);
    }
  }
}

function stringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
  }
}

export function getAiClient(): AiClient {
  return {
    getModelName(): string {
      const model = process.env.GEMINI_MODEL?.trim();
      if (!model) throw new AiUnavailableError("GEMINI_MODEL must be configured", { code: "AI_NOT_CONFIGURED" });
      return model;
    },
    async generateStructured<T>(schema: StructuredOutputSchema<T>, system: string, user: string, options?: AiRequestOptions): Promise<T> {
      const { client, model } = createGeminiRuntime();
      const timeoutMs = Math.min(getAiTimeoutMs(), options?.timeoutMs ?? getAiTimeoutMs());
      const deadlineAt = Date.now() + timeoutMs;
      const interaction = await withProviderRetry((remainingMs) => client.interactions.create({
        model,
        store: false,
        input: user,
        system_instruction: system,
        generation_config: { temperature: 0.1 },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: schema.jsonSchema,
        },
      }, {
        timeout_ms: Math.min(getAiTimeoutMs(), remainingMs),
        retries: { strategy: "none" },
        ...(options?.signal ? { signal: options.signal } : {}),
      }), { signal: options?.signal, deadlineAt });

      if (typeof interaction.output_text !== "string") {
        throw unavailable("Gemini returned no structured text", new Error("Provider response did not include structured text"), "AI_BAD_OUTPUT");
      }

      let output: unknown;
      try {
        output = JSON.parse(interaction.output_text) as unknown;
      } catch (error) {
        throw unavailable("Gemini returned invalid JSON", error, "AI_BAD_OUTPUT");
      }

      try {
        return schema.parse(output);
      } catch (error) {
        throw unavailable("Gemini output failed schema validation", error, "AI_BAD_OUTPUT");
      }
    },

    async runToolCallingLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
      const { client, model } = createGeminiRuntime();
      const totalTimeoutMs = Math.min(getAiTimeoutMs(), options.timeoutMs ?? getAiTimeoutMs());
      const deadlineAt = Date.now() + totalTimeoutMs;
      const declaredTools = new Map(options.tools.map((tool) => [tool.name, tool]));
      const providerTools: Interactions.Tool[] = options.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      const history: Interactions.Step[] = [{
        type: "user_input",
        content: [{ type: "text", text: options.user }],
      }];
      const toolCalls: ToolCallRecord[] = [];
      const maxSteps = Math.min(6, Math.max(1, Math.floor(options.maxSteps)));

      for (let stepNumber = 0; stepNumber < maxSteps; stepNumber += 1) {
        if (options.signal?.aborted || Date.now() >= deadlineAt) {
          throw unavailable("Gemini tool loop timed out", new Error("AI request exceeded its time budget"));
        }
        const interaction = await withProviderRetry((remainingMs) => client.interactions.create({
          model,
          store: false,
          input: history,
          system_instruction: options.system,
          generation_config: { temperature: 0.1 },
          tools: providerTools,
        }, {
          timeout_ms: Math.min(getAiTimeoutMs(), remainingMs),
          retries: { strategy: "none" },
          ...(options.signal ? { signal: options.signal } : {}),
        }), { signal: options.signal, deadlineAt });
        history.push(...interaction.steps);

        const calls = interaction.steps.filter((step): step is Interactions.FunctionCallStep => step.type === "function_call");
        if (calls.length === 0) {
          return { toolCalls, outputText: interaction.output_text ?? null };
        }

        for (const call of calls) {
          if (options.signal?.aborted || Date.now() >= deadlineAt) {
            throw unavailable("Gemini tool loop timed out", new Error("AI request exceeded its time budget"));
          }
          const invocation = { name: call.name, arguments: call.arguments };
          toolCalls.push(invocation);
          if (!declaredTools.has(call.name)) {
            return { toolCalls, outputText: null, error: `Unknown tool requested: ${call.name}` };
          }

          let result: unknown;
          try {
            result = await options.executeTool(call.name, call.arguments);
          } catch (error) {
            result = { error: error instanceof Error ? error.message : "Tool execution failed" };
          }
          history.push({
            type: "function_result",
            call_id: call.id,
            name: call.name,
            result: [{ type: "text", text: stringifyToolResult(result) }],
          });
        }
      }

      return { toolCalls, outputText: null, error: "Maximum tool-calling steps exceeded" };
    },
  };
}
