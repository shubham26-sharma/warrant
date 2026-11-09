import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getDbConnectTimeoutMs, getDbQueryTimeoutMs } from "../timeout";

const globalPrisma = globalThis as typeof globalThis & {
  warrantPrisma?: PrismaClient;
  warrantPrismaUrl?: string;
};

export function getPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const connectTimeoutMs = getDbConnectTimeoutMs();
  const queryTimeoutMs = getDbQueryTimeoutMs();
  const cacheKey = `${connectionString}|${connectTimeoutMs}|${queryTimeoutMs}`;
  if (globalPrisma.warrantPrisma && globalPrisma.warrantPrismaUrl === cacheKey) {
    return globalPrisma.warrantPrisma;
  }

  const adapter = new PrismaPg(
    {
      connectionString,
      max: 5,
      connectionTimeoutMillis: connectTimeoutMs,
      idleTimeoutMillis: 20_000,
      query_timeout: queryTimeoutMs,
      allowExitOnIdle: true,
    },
    {
      onPoolError: (error) => {
        console.warn(`[Database] Pool error: ${error.name}`);
      },
      onConnectionError: (error) => {
        console.warn(`[Database] Connection error: ${error.name}`);
      },
    },
  );
  const client = new PrismaClient({ adapter });
  globalPrisma.warrantPrisma = client;
  globalPrisma.warrantPrismaUrl = cacheKey;
  return client;
}
