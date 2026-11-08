import { loadScriptEnvironment, requireEnvironmentVariables } from "./env";

import { runScriptedAgent } from "../src/lib/ai/scripted-agent";
import { createSemanticCheck } from "../src/lib/ai/semantic-check";
import { MandateSchema } from "../src/lib/schemas/mandate";
import { getPrismaClient } from "../src/lib/db/prisma";
import { PrismaStore } from "../src/lib/store/prisma";

loadScriptEnvironment();

let prismaClient: ReturnType<typeof getPrismaClient> | undefined;
async function main() {
  const prisma = prismaClient = getPrismaClient();
  const store = new PrismaStore(prisma);
  const mandates = (await store.listMandates()).filter((mandate) => mandate.status === "CONFIRMED").sort((a, b) => b.version - a.version);
  const mandateRecord = mandates[0];
  if (!mandateRecord) throw new Error("Run npm run db:seed before demo warmup");
  const mandate = MandateSchema.parse(mandateRecord);
  const proposal = runScriptedAgent("compliant");
  const result = await createSemanticCheck(store)(mandate, proposal.cart);
  console.log(`Semantic cache warmed for the sample proposal (${result.verdict}).`);
}

const configured = requireEnvironmentVariables(["DATABASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL"]);
if (configured) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo warmup failed");
  process.exitCode = 1;
}).finally(async () => {
  await prismaClient?.$disconnect();
});
else process.exitCode = 1;
