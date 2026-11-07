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

export class AiUnavailableError extends Error {
  constructor(message = "Gemini is unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "AiUnavailableError";
  }
}

const MAX_RETRIES = 1;

type GeminiRuntime = { client: GoogleGenAI; model: string };

function createGeminiRuntime(): GeminiRuntime {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new AiUnavailableError("GEMINI_API_KEY and GEMINI_MODEL must be configured");
  }
  try {
    return { client: new GoogleGenAI({ apiKey }), model };
  } catch (error) {
    throw new AiUnavailableError("Gemini client could not be initialized", { cause: error });
  }
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  if (typeof value.status === "number") return value.status;
  if (typeof value.status === "string" && /^\d+$/.test(value.status)) return Number(value.status);
  if (typeof value.statusCode === "number") return value.statusCode;
  if (typeof value.statusCode === "string" && /^\d+$/.test(value.statusCode)) return Number(value.statusCode);
  if (typeof value.code === "number") return value.code;
  return undefined;
}

function isTransient(error: unknown): boolean {
  const status = getStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  return name.includes("timeout") || message.includes("timeout") || message.includes("timed out") ||
    ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(code);
}

function unavailable(message: string, cause: unknown): AiUnavailableError {
  logAiFailure(cause);
  return new AiUnavailableError(message, { cause });
}

async function withProviderRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error("AI request aborted by its total time budget");
      return await operation();
    } catch (error) {
      if (attempt < MAX_RETRIES && !signal?.aborted && isTransient(error)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      throw unavailable("Gemini request failed", error);
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
      if (!model) throw new AiUnavailableError("GEMINI_MODEL must be configured");
      return model;
    },
    async generateStructured<T>(schema: StructuredOutputSchema<T>, system: string, user: string, options?: AiRequestOptions): Promise<T> {
      const { client, model } = createGeminiRuntime();
      const interaction = await withProviderRetry(() => client.interactions.create({
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
        timeout_ms: Math.min(getAiTimeoutMs(), options?.timeoutMs ?? getAiTimeoutMs()),
        ...(options?.signal ? { fetch_options: { signal: options.signal } } : {}),
        maxRetries: 0,
      }), options?.signal);

      if (typeof interaction.output_text !== "string") {
        throw unavailable("Gemini returned no structured text", new Error("Provider response did not include structured text"));
      }

      let output: unknown;
      try {
        output = JSON.parse(interaction.output_text) as unknown;
      } catch (error) {
        throw unavailable("Gemini returned invalid JSON", error);
      }

      try {
        return schema.parse(output);
      } catch (error) {
        throw unavailable("Gemini output failed schema validation", error);
      }
    },

    async runToolCallingLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
      const { client, model } = createGeminiRuntime();
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
        const interaction = await withProviderRetry(() => client.interactions.create({
          model,
          store: false,
          input: history,
          system_instruction: options.system,
          generation_config: { temperature: 0.1 },
          tools: providerTools,
        }, {
          timeout_ms: Math.min(getAiTimeoutMs(), options.timeoutMs ?? getAiTimeoutMs()),
          ...(options.signal ? { fetch_options: { signal: options.signal } } : {}),
          maxRetries: 0,
        }), options.signal);
        history.push(...interaction.steps);

        const calls = interaction.steps.filter((step): step is Interactions.FunctionCallStep => step.type === "function_call");
        if (calls.length === 0) {
          return { toolCalls, outputText: interaction.output_text ?? null };
        }

        for (const call of calls) {
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
