import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import type { OrderAuthorization } from "../src/lib/gateway/authorize";
import { paypalClient } from "../src/lib/paypal";

async function main() {
  const testOnlyAuthorization = {
    decisionId: "smoke-test-authorization",
    mandateId: "smoke-test-mandate",
    cart: {} as OrderAuthorization["cart"],
    totalCents: 1000,
    currency: "USD",
  } as unknown as OrderAuthorization;
  const baseUrl = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  const order = await paypalClient.createPayPalOrder(testOnlyAuthorization, {
    returnUrl: `${baseUrl}/paypal/return`,
    cancelUrl: `${baseUrl}/paypal/cancel`,
  });
  console.log(`Sandbox order ${order.orderId} (${order.status})`);
  console.log(order.approvalUrl);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PayPal smoke test failed");
  process.exitCode = 1;
});
