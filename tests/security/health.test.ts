import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ getPrismaClient: vi.fn() }));

import { GET as shallowHealth } from "../../src/app/api/health/route";
import { DATABASE_HEALTH_TIMEOUT_MS, GET as deepHealth } from "../../src/app/api/health/deep/route";
import { getPrismaClient } from "../../src/lib/db/prisma";

const getPrismaMock = vi.mocked(getPrismaClient);

describe("health endpoints", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("returns shallow health without accessing the database", async () => {
    getPrismaMock.mockImplementation(() => { throw new Error("database must not be touched"); });
    const response = await shallowHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(getPrismaMock).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response within four seconds when the database hangs", async () => {
    vi.useFakeTimers();
    getPrismaMock.mockReturnValue({ $queryRaw: vi.fn(() => new Promise(() => {})) } as unknown as ReturnType<typeof getPrismaClient>);
    const responsePromise = deepHealth();
    await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", database: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns healthy when the database query succeeds", async () => {
    getPrismaMock.mockReturnValue({ $queryRaw: vi.fn(async () => [{ 1: 1 }]) } as unknown as ReturnType<typeof getPrismaClient>);
    const response = await deepHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "connected" });
  });
});
