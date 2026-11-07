import { describe, expect, it } from "vitest";
import {
  buildCart, DEMO_MERCHANT_ID, DEMO_MERCHANT_LABEL, PRODUCTS,
} from "../../src/lib/catalog/products";

describe("demo product catalog", () => {
  it("includes the required deliberately varied products and labels its demo merchant", () => {
    expect(DEMO_MERCHANT_LABEL.toLowerCase()).toContain("demo");
    expect(PRODUCTS.some((product) => product.id === "a4-recycled-standard" && product.unitPriceCents === 1000 && product.shippingCents === 500 && product.deliveryDays === 2)).toBe(true);
    expect(PRODUCTS.some((product) => product.unitPriceCents === 1400)).toBe(true);
    expect(PRODUCTS.some((product) => product.attributes.size === "A3")).toBe(true);
    expect(PRODUCTS.some((product) => product.attributes.material === "virgin-pulp")).toBe(true);
    expect(PRODUCTS.some((product) => product.description.includes("A3 sheets") && product.attributes.size === "A4")).toBe(true);
    expect(PRODUCTS.some((product) => product.attributes.size === null)).toBe(true);
    expect(PRODUCTS.some((product) => product.deliveryDays === 6)).toBe(true);
    expect(PRODUCTS.some((product) => /ignore the mandate/i.test(product.description))).toBe(true);
    expect(PRODUCTS.some((product) => product.deliveryDays === null)).toBe(true);
    expect(PRODUCTS.some((product) => product.merchantId === "bulk-paper-outlet")).toBe(true);
    expect(PRODUCTS.every((product) => product.taxCents === 0)).toBe(true);
  });

  it("builds carts using server catalog prices and consistent totals", () => {
    const cart = buildCart([{ productId: "a4-recycled-standard", quantity: 5 }]);
    expect(cart.merchantId).toBe(DEMO_MERCHANT_ID);
    expect(cart.lineItems[0].unitPriceCents).toBe(1000);
    expect(cart.subtotalCents).toBe(5000);
    expect(cart.shippingCents).toBe(500);
    expect(cart.taxCents).toBe(0);
    expect(cart.totalCents).toBe(5500);
    expect(cart.deliveryDays).toBe(2);

    const forgedItem: { productId: string; quantity: number } = { productId: "a4-recycled-standard", quantity: 1 };
    Object.assign(forgedItem, { unitPriceCents: 1 });
    const attemptedPrice = buildCart([forgedItem]);
    expect(attemptedPrice.lineItems[0].unitPriceCents).toBe(1000);
  });

  it("rejects unknown products, invalid quantities, and mixed merchants", () => {
    expect(() => buildCart([{ productId: "missing", quantity: 1 }])).toThrow(/Unknown product/);
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildCart([{ productId: "a4-recycled-standard", quantity }])).toThrow(/quantities/);
    }
    expect(() => buildCart([
      { productId: "a4-recycled-standard", quantity: 1 },
      { productId: "bulk-a4-recycled", quantity: 1 },
    ])).toThrow(/multiple merchants/);
  });
});
