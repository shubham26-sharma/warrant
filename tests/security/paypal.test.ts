import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalUnavailableError } from "../../src/lib/errors";
import { paypalClient } from "../../src/lib/paypal";
import { PAYPAL_REQUEST_TIMEOUT_MS } from "../../src/lib/timeout";
import type { OrderAuthorization } from "../../src/lib/gateway/authorize";

describe("PayPal Sandbox client", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("creates a human-approved CAPTURE order with integer cents and idempotency", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      return new Response(JSON.stringify({
        id: "ORDER-TEST", status: "CREATED",
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-TEST" }],
      }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = {
      decisionId: "decision-1", mandateId: "mandate-1", cart: {}, totalCents: 5501, currency: "USD",
    } as unknown as OrderAuthorization;
    const result = await paypalClient.createPayPalOrder(auth, { returnUrl: "https://app.test/paypal/return", cancelUrl: "https://app.test/paypal/cancel" });
    expect(result).toMatchObject({ orderId: "ORDER-TEST", status: "CREATED" });
    expect(result.approvalUrl).toContain("checkoutnow");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const options = fetchMock.mock.calls[1]?.[1];
    expect(options?.method).toBe("POST");
    expect(options?.headers).toMatchObject({ "PayPal-Request-Id": "order-decision-1" });
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units).toEqual([{ reference_id: "decision-1", amount: { currency_code: "USD", value: "55.01" } }]);
    expect(body.payment_source).toEqual({ paypal: { experience_context: {
      return_url: "https://app.test/paypal/return", cancel_url: "https://app.test/paypal/cancel",
      user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
    } } });
  });

  it("uses only PayPal module references for PayPal credentials and has no development payment route", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "src");
    const sources: Array<{ path: string; source: string }> = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) sources.push({ path, source: readFileSync(path, "utf8") });
      }
    };
    visit(root);
    const leakedEnv = sources.filter(({ path, source }) => /process\.env\.PAYPAL_(?:CLIENT_ID|CLIENT_SECRET)/.test(source) && !path.endsWith(join("lib", "paypal.ts")));
    expect(leakedEnv).toEqual([]);
    expect(sources.some(({ path }) => path.includes(`${join("app", "api", "dev")}`))).toBe(false);

    const smokeScript = readFileSync(join(process.cwd(), "scripts", "paypal-smoke.ts"), "utf8");
    expect(smokeScript).toContain("startCheckout(store, decision.id");
    expect(smokeScript).not.toMatch(/paypalClient\.createPayPalOrder|paypalClient\.capturePayPalOrder/);
  });

  it("aborts and fails fast with PayPalUnavailableError when PayPal hangs past its timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);

    const auth = {
      decisionId: "decision-timeout", mandateId: "mandate-1", cart: {}, totalCents: 1000, currency: "USD",
    } as unknown as OrderAuthorization;

    const promise = paypalClient.createPayPalOrder(auth, {
      returnUrl: "https://app.test/paypal/return",
      cancelUrl: "https://app.test/paypal/cancel",
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(PayPalUnavailableError);
    await vi.advanceTimersByTimeAsync(PAYPAL_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
