import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { AiBudgetExceededError } from "../../src/lib/ai/budget";
import { compileMandate } from "../../src/lib/ai/compile-mandate";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import { runAgent } from "../../src/lib/ai/agent";

const createInteractionMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    interactions = { create: createInteractionMock };
  },
}));

import { AiUnavailableError, getAiClient } from "../../src/lib/ai/client";

const mandate = MandateSchema.parse(fixture.baseMandate);

describe("AI client timeouts and bounded retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
    vi.stubEnv("AI_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("disables SDK retries and never retries a timeout error", async () => {
    createInteractionMock.mockRejectedValueOnce(Object.assign(new Error("Request timed out"), { name: "RequestTimeoutError" }));

    const client = getAiClient();
    await expect(client.generateStructured(
      { jsonSchema: { type: "object" }, parse: (value) => value },
      "system",
      "user",
    )).rejects.toBeInstanceOf(AiUnavailableError);

    expect(createInteractionMock).toHaveBeenCalledTimes(1);
    const requestOptions = createInteractionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(requestOptions).toMatchObject({ retries: { strategy: "none" } });
    expect(requestOptions).not.toHaveProperty("maxRetries");
    expect(requestOptions).not.toHaveProperty("fetch_options");
  });

  it("forwards an active AbortSignal directly and stops tool loops when aborted", async () => {
    const controller = new AbortController();
    createInteractionMock.mockImplementationOnce(async () => {
      controller.abort();
      return {
        steps: [{ type: "function_call", id: "call-1", name: "get_mandate", arguments: {} }],
        output_text: null,
      };
    });

    await expect(runAgent(mandate, "Buy paper", getAiClient(), {
      signal: controller.signal,
      timeoutMs: 1000,
    })).rejects.toBeInstanceOf(AiUnavailableError);

    expect(createInteractionMock).toHaveBeenCalledTimes(1);
    const requestOptions = createInteractionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(requestOptions?.signal).toBe(controller.signal);
  });

  it("bounds compileMandate with withAiBudget when called directly", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_TIMEOUT_MS", "250");
    createInteractionMock.mockImplementation((_params: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));

    const promise = compileMandate("Buy paper", "USD", getAiClient());
    const assertion = expect(promise).rejects.toBeInstanceOf(AiBudgetExceededError);
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

