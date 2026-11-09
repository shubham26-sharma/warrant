import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pgConstructMock = vi.hoisted(() => vi.fn());
const prismaConstructMock = vi.hoisted(() => vi.fn());

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {
    constructor(config: unknown, options: unknown) {
      pgConstructMock(config, options);
    }
  },
}));

vi.mock("../../src/generated/prisma/client", () => ({
  PrismaClient: class MockPrismaClient {
    constructor(options: unknown) {
      prismaConstructMock(options);
    }
  },
}));

import { getPrismaClient } from "../../src/lib/db/prisma";

describe("getPrismaClient pooling and singleton lifecycle", () => {
  const globalWithPrisma = globalThis as typeof globalThis & {
    warrantPrisma?: unknown;
    warrantPrismaUrl?: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete globalWithPrisma.warrantPrisma;
    delete globalWithPrisma.warrantPrismaUrl;
  });

  afterEach(() => {
    delete globalWithPrisma.warrantPrisma;
    delete globalWithPrisma.warrantPrismaUrl;
    vi.unstubAllEnvs();
  });

  it("reuses the PrismaClient singleton and configures bounded timeouts in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@ep-demo.neon.tech/neondb?sslmode=verify-full");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(prismaConstructMock).toHaveBeenCalledTimes(1);
    expect(pgConstructMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 5,
        connectionTimeoutMillis: 4000,
        query_timeout: 5000,
        idleTimeoutMillis: 20_000,
        allowExitOnIdle: true,
      }),
      expect.objectContaining({
        onPoolError: expect.any(Function),
        onConnectionError: expect.any(Function),
      }),
    );
  });

  it("creates a fresh client when DATABASE_URL changes", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@one.neon.tech/neondb?sslmode=verify-full");
    const first = getPrismaClient();

    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@two.neon.tech/neondb?sslmode=verify-full");
    const second = getPrismaClient();

    expect(first).not.toBe(second);
    expect(prismaConstructMock).toHaveBeenCalledTimes(2);
  });
});

