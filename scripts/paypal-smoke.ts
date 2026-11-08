import { loadScriptEnvironment, requireEnvironmentVariables } from "./env";

import { evaluateProposal, startCheckout } from "../src/lib/gateway/purchase";
import { MemoryStore } from "../src/lib/store/memory";
import { seedSampleMandate } from "../src/lib/mandates/sample";

loadScriptEnvironment();

async function main() {
  const store = new MemoryStore();
  const mandate = await seedSampleMandate(store);
  const { decision } = await evaluateProposal(
    store,
    mandate.mandateId,
    [{ productId: "a4-recycled-standard", quantity: 1 }],
    "AGENT_SCRIPTED",
    async () => ({ verdict: "APPROVE", reasons: ["PayPal smoke test"] }),
  );
  const baseUrl = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  const order = await startCheckout(store, decision.id, {
    returnUrl: `${baseUrl}/paypal/return`,
    cancelUrl: `${baseUrl}/paypal/cancel`,
  });
  console.log(`Sandbox order ${order.paypalOrderId} (${order.status})`);
  console.log(order.approvalUrl);
}

const configured = requireEnvironmentVariables(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
if (configured) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PayPal smoke test failed");
  process.exitCode = 1;
});
else process.exitCode = 1;
