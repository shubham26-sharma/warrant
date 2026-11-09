import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ getPrismaClient: vi.fn() }));

import { GET as shallowHealth } from "../../src/app/api/health/route";
import { GET as deepHealth } from "../../src/app/api/health/deep/route";
import { DATABASE_HEALTH_TIMEOUT_MS } from "../../src/lib/health";
import { getPrismaClient } from "../../src/lib/db/prisma";

const getPrismaMock = vi.mocked(getPrismaClient);

describe("health endpoints", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  function stubAllRequiredEnv() {
    vi.stubEnv("PAYPAL_CLIENT_ID", "secret-paypal-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret-paypal-client-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://user:secret-pass@ep-demo.us-east-1.aws.neon.tech/neondb?sslmode=verify-full");
    vi.stubEnv("DIRECT_URL", "postgresql://user:secret-pass@ep-demo-direct.us-east-1.aws.neon.tech/neondb?sslmode=verify-full");
    vi.stubEnv("GEMINI_API_KEY", "secret-gemini-api-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
    vi.stubEnv("AUDIT_HMAC_SECRET", "secret-audit-hmac-value");
    vi.stubEnv("APP_BASE_URL", "https://warrant.onrender.com");
    vi.stubEnv("NODE_VERSION", "24.22.1");
  }

  it("returns shallow health without accessing the database", async () => {
    getPrismaMock.mockImplementation(() => { throw new Error("database must not be touched"); });
    const response = await shallowHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(getPrismaMock).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response within ten seconds when the database hangs", async () => {
    stubAllRequiredEnv();
    vi.useFakeTimers();
    let rejectHungQuery!: (error: Error) => void;
    const queryRaw = vi.fn(() => new Promise((_resolve, reject) => {
      rejectHungQuery = reject;
    }));
    getPrismaMock.mockReturnValue({ $queryRaw: queryRaw } as unknown as ReturnType<typeof getPrismaClient>);
    expect(DATABASE_HEALTH_TIMEOUT_MS).toBe(10_000);

    const responsePromise = deepHealth();
    await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      database: "unavailable",
      config: { ok: true, missing: [] },
    });
    expect(vi.getTimerCount()).toBe(0);

    // A late connection error settling after the 10s timeout must not trigger an orphaned retry.
    rejectHungQuery(new Error("Connection terminated due to connection timeout"));
    await Promise.resolve();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("retries once on connection errors in deep health before succeeding or returning 503", async () => {
    stubAllRequiredEnv();
    const transient = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Connection terminated due to connection timeout"), {
        cause: new Error("Connection terminated unexpectedly"),
      }))
      .mockResolvedValueOnce([{ 1: 1 }]);
    getPrismaMock.mockReturnValue({ $queryRaw: transient } as unknown as ReturnType<typeof getPrismaClient>);

    const okResponse = await deepHealth();
    expect(okResponse.status).toBe(200);
    expect(transient).toHaveBeenCalledTimes(2);

    const persistent = vi.fn().mockRejectedValue(Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }));
    getPrismaMock.mockReturnValue({ $queryRaw: persistent } as unknown as ReturnType<typeof getPrismaClient>);

    const failResponse = await deepHealth();
    expect(failResponse.status).toBe(503);
    expect(persistent).toHaveBeenCalledTimes(2);

    const syntaxError = vi.fn().mockRejectedValue(new Error("relation does not exist"));
    getPrismaMock.mockReturnValue({ $queryRaw: syntaxError } as unknown as ReturnType<typeof getPrismaClient>);

    const nonConnectionResponse = await deepHealth();
    expect(nonConnectionResponse.status).toBe(503);
    expect(syntaxError).toHaveBeenCalledTimes(1);
  });

  it("returns healthy when the database query succeeds", async () => {
    stubAllRequiredEnv();
    getPrismaMock.mockReturnValue({ $queryRaw: vi.fn(async () => [{ 1: 1 }]) } as unknown as ReturnType<typeof getPrismaClient>);
    const response = await deepHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: "connected",
      config: { ok: true, missing: [] },
    });
  });

  it("lists only missing required variable names in config and never exposes values", async () => {
    stubAllRequiredEnv();
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("APP_BASE_URL", "");
    getPrismaMock.mockReturnValue({ $queryRaw: vi.fn(async () => [{ 1: 1 }]) } as unknown as ReturnType<typeof getPrismaClient>);

    const response = await deepHealth();
    const raw = await response.text();
    const body = JSON.parse(raw) as { status: string; database: string; config: { ok: boolean; missing: string[] } };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      database: "connected",
      config: { ok: false, missing: ["GEMINI_API_KEY", "APP_BASE_URL"] },
    });
    expect(raw).not.toContain("secret-");
    expect(raw).not.toContain("gemini-3.5-flash-lite");
    expect(raw).not.toContain("neondb");
  });
});
