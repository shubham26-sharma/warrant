import { loadScriptEnvironment, requireEnvironmentVariables } from "./env";

import { getPrismaClient } from "../src/lib/db/prisma";
import { PrismaStore } from "../src/lib/store/prisma";
import { seedSampleMandate } from "../src/lib/mandates/sample";

loadScriptEnvironment();

let prismaClient: ReturnType<typeof getPrismaClient> | undefined;
async function main() {
  const prisma = prismaClient = getPrismaClient();
  const store = new PrismaStore(prisma);
  const prior = (await store.listMandatesByFamily("550e8400-e29b-41d4-a716-446655440000")).length;
  const seeded = await seedSampleMandate(store);
  console.log(prior ? `Sample confirmed mandate already seeded (version ${seeded.version}).` : "Seeded the sample confirmed mandate.");
}

const configured = requireEnvironmentVariables(["DATABASE_URL"]);
if (configured) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database seed failed");
  process.exitCode = 1;
}).finally(async () => {
  await prismaClient?.$disconnect();
});
else process.exitCode = 1;
