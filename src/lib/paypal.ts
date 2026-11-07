import { z } from "zod";
import { centsToDecimalString } from "./money";
import type { OrderAuthorization } from "./gateway/authorize";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

export interface PayPalOrderSnapshot {
  orderId: string;
  status: string;
  amountCents: number;
  currency: string;
  captureId: string | null;
}
export interface CreatedPayPalOrder { orderId: string; status: string; approvalUrl: string }
export interface PayPalClient {
  createPayPalOrder(auth: OrderAuthorization, urls: { returnUrl: string; cancelUrl: string }): Promise<CreatedPayPalOrder>;
  getPayPalOrder(orderId: string): Promise<PayPalOrderSnapshot>;
  capturePayPalOrder(orderId: string): Promise<PayPalOrderSnapshot>;
}

const TokenSchema = z.object({ access_token: z.string().min(1) });
const PayPalOrderSchema = z.object({
  id: z.string().min(1), status: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.url() }).passthrough()).optional(),
  purchase_units: z.array(z.object({
    amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
    payments: z.object({ captures: z.array(z.object({ id: z.string().optional(), status: z.string().optional() }).passthrough()).optional() }).optional(),
  }).passthrough()).optional(),
}).passthrough();

function requiredPayPalEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("PayPal Sandbox credentials are not configured");
  return { clientId, clientSecret };
}

export async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = requiredPayPalEnv();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`PayPal token request failed (${response.status})`);
  return TokenSchema.parse(await response.json()).access_token;
}

async function payPalRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`${SANDBOX_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`PayPal request failed (${response.status})`);
  return response.json();
}

function parseSnapshot(value: unknown): PayPalOrderSnapshot {
  const order = PayPalOrderSchema.parse(value);
  const unit = order.purchase_units?.[0];
  const amount = unit?.amount;
  const match = amount ? /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(amount.value) : null;
  if (!amount || !match) throw new Error("PayPal order response omitted a valid amount");
  const centsBig = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (centsBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PayPal order amount is too large");
  const cents = Number(centsBig);
  const captureId = unit?.payments?.captures?.[0]?.id ?? null;
  return { orderId: order.id, status: order.status, amountCents: cents, currency: amount.currency_code, captureId };
}

export const paypalClient: PayPalClient = {
  async createPayPalOrder(auth, urls) {
    const value = await payPalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `order-${auth.decisionId}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: auth.decisionId,
          amount: { currency_code: auth.currency, value: centsToDecimalString(auth.totalCents) },
        }],
        payment_source: { paypal: { experience_context: {
          return_url: urls.returnUrl,
          cancel_url: urls.cancelUrl,
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
        } } },
      }),
    });
    const order = PayPalOrderSchema.parse(value);
    const approvalUrl = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
    if (!approvalUrl) throw new Error("PayPal response did not contain an approval URL");
    return { orderId: order.id, status: order.status, approvalUrl };
  },
  async getPayPalOrder(orderId) {
    return parseSnapshot(await payPalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" }));
  },
  async capturePayPalOrder(orderId) {
    return parseSnapshot(await payPalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST", headers: { "PayPal-Request-Id": `capture-${orderId}` }, body: "{}",
    }));
  },
};
