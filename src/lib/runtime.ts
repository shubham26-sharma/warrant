import { getPrismaClient } from "./db/prisma";
import { PrismaStore } from "./store/prisma";

let store: PrismaStore | undefined;

export function getStore(): PrismaStore {
  store ??= new PrismaStore(getPrismaClient());
  return store;
}

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "http://localhost:3000";
}
