import type { PrismaClient } from "../generated/prisma/client";
import { getPrismaClient } from "./db/prisma";
import { PrismaStore } from "./store/prisma";
import { withStoreTimeout } from "./store/timeout";
import type { Store } from "./store/types";

let cached: { prisma: PrismaClient; store: Store } | undefined;

export function getStore(): Store {
  const prisma = getPrismaClient();
  if (!cached || cached.prisma !== prisma) {
    cached = { prisma, store: withStoreTimeout(new PrismaStore(prisma)) };
  }
  return cached.store;
}

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "http://localhost:3000";
}
