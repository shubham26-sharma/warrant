import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { getPrismaClient } from "../src/lib/db/prisma";
import { PrismaStore } from "../src/lib/store/prisma";
import { seedSampleMandate } from "../src/lib/mandates/sample";

let prismaClient: ReturnType<typeof getPrismaClient> | undefined;
async function main() {
  const prisma = prismaClient = getPrismaClient();
  const store = new PrismaStore(prisma);
  const prior = (await store.listMandatesByFamily("550e8400-e29b-41d4-a716-446655440000")).length;
  const seeded = await seedSampleMandate(store);
  console.log(prior ? `Sample confirmed mandate already seeded (version ${seeded.version}).` : "Seeded the sample confirmed mandate.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database seed failed");
  process.exitCode = 1;
}).finally(async () => {
  await prismaClient?.$disconnect();
});
