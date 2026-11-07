import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const globalPrisma = globalThis as typeof globalThis & { warrantPrisma?: PrismaClient };

export function getPrismaClient(): PrismaClient {
  if (globalPrisma.warrantPrisma) return globalPrisma.warrantPrisma;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== "production") globalPrisma.warrantPrisma = client;
  return client;
}
