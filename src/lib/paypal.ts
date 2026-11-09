import { z } from "zod";
import { PAYPAL_SANDBOX_API_BASE } from "./env-config";
import { PayPalUnavailableError } from "./errors";
import { centsToDecimalString } from "./money";
import { PAYPAL_REQUEST_TIMEOUT_MS, TimeoutError, withTimeout } from "./timeout";
import type { OrderAuthorization } from "./gateway/authorize";

const SANDBOX_API = PAYPAL_SANDBOX_API_BASE;

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
  if (!clientId || !clientSecret) throw new PayPalUnavailableError("PayPal Sandbox credentials are not configured");
  return { clientId, clientSecret };
}

async function fetchJsonWithPayPalTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await withTimeout(
      fetch(url, { ...init, signal: controller.signal }),
      timeoutMs,
      "PayPal Sandbox request timed out",
    );
    if (!response.ok) throw new PayPalUnavailableError(`PayPal request failed (${response.status})`);
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    try {
      return await withTimeout(response.json(), remainingMs, "PayPal Sandbox response timed out");
    } catch (error) {
      if (error instanceof TimeoutError) throw error;
      throw new PayPalUnavailableError("PayPal returned invalid JSON", { cause: error });
    }
  } catch (error) {
    if (error instanceof PayPalUnavailableError) throw error;
    if (error instanceof TimeoutError) {
      throw new PayPalUnavailableError("PayPal Sandbox request timed out", { cause: error });
    }
    throw new PayPalUnavailableError("PayPal Sandbox request failed", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken(timeoutMs = PAYPAL_REQUEST_TIMEOUT_MS): Promise<string> {
  const { clientId, clientSecret } = requiredPayPalEnv();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const payload = await fetchJsonWithPayPalTimeout(`${SANDBOX_API}/v1/oauth2/token`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }, Math.max(1, timeoutMs));
  try {
    return TokenSchema.parse(payload).access_token;
  } catch (error) {
    throw new PayPalUnavailableError("PayPal returned an invalid token response", { cause: error });
  }
}

async function payPalRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const deadlineAt = Date.now() + PAYPAL_REQUEST_TIMEOUT_MS;
  const token = await getAccessToken(Math.max(1, deadlineAt - Date.now()));
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  return fetchJsonWithPayPalTimeout(`${SANDBOX_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  }, remainingMs);
}

function parseSnapshot(value: unknown): PayPalOrderSnapshot {
  let order: z.infer<typeof PayPalOrderSchema>;
  try {
    order = PayPalOrderSchema.parse(value);
  } catch (error) {
    throw new PayPalUnavailableError("PayPal order response failed validation", { cause: error });
  }
  const unit = order.purchase_units?.[0];
  const amount = unit?.amount;
  const match = amount ? /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(amount.value) : null;
  if (!amount || !match) throw new PayPalUnavailableError("PayPal order response omitted a valid amount");
  const centsBig = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (centsBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new PayPalUnavailableError("PayPal order amount is too large");
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
    let order: z.infer<typeof PayPalOrderSchema>;
    try {
      order = PayPalOrderSchema.parse(value);
    } catch (error) {
      throw new PayPalUnavailableError("PayPal order response failed validation", { cause: error });
    }
    const approvalUrl = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
    if (!approvalUrl) throw new PayPalUnavailableError("PayPal response did not contain an approval URL");
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
