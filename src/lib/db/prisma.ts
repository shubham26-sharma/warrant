import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { DATABASE_CONNECT_TIMEOUT_MS, DATABASE_OPERATION_TIMEOUT_MS } from "../timeout";

const globalPrisma = globalThis as typeof globalThis & {
  warrantPrisma?: PrismaClient;
  warrantPrismaUrl?: string;
};

export function getPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (globalPrisma.warrantPrisma && globalPrisma.warrantPrismaUrl === connectionString) {
    return globalPrisma.warrantPrisma;
  }

  const adapter = new PrismaPg(
    {
      connectionString,
      max: 5,
      connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 20_000,
      query_timeout: DATABASE_OPERATION_TIMEOUT_MS,
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
  globalPrisma.warrantPrismaUrl = connectionString;
  return client;
}
