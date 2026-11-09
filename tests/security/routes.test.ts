import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as compilePost } from "../../src/app/api/mandates/compile/route";

describe("route fail-closed behavior", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a REVIEW-safe unavailable response instead of crashing when Gemini is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_MODEL", "");
    const response = await compilePost(new Request("http://localhost/api/mandates/compile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Buy paper", currency: "USD" }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI check unavailable" });
  });

  it("rejects malformed JSON with a typed client error", async () => {
    const response = await compilePost(new Request("http://localhost/api/mandates/compile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });

  it("returns 503 without leaking error details when AI_TIMEOUT_MS configuration is invalid", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
    vi.stubEnv("AI_TIMEOUT_MS", "invalid-number");
    const response = await compilePost(new Request("http://localhost/api/mandates/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `compile-invalid-timeout-${Date.now()}` },
      body: JSON.stringify({ text: "Buy paper", currency: "USD" }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI check unavailable" });
  });
});
