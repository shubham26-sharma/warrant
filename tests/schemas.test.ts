import { describe, expect, it } from "vitest";
import fixture from "./fixtures/scenarios.json";
import { CartSchema } from "../src/lib/schemas/cart";
import { MandateSchema } from "../src/lib/schemas/mandate";

describe("schemas", () => {
  it("accepts the provided confirmed base mandate", () => {
    expect(MandateSchema.safeParse(fixture.baseMandate).success).toBe(true);
  });

  it("requires unresolved clauses when a mandate is ambiguous", () => {
    const mandate = { ...fixture.baseMandate, ambiguity: { hasAmbiguity: true, unresolvedClauses: [] } };
    expect(MandateSchema.safeParse(mandate).success).toBe(false);
  });

  it("does not allow a confirmed ambiguous mandate", () => {
    const mandate = { ...fixture.baseMandate, ambiguity: { hasAmbiguity: true, unresolvedClauses: ["cheapest"] } };
    expect(MandateSchema.safeParse(mandate).success).toBe(false);
  });

  it("accepts fixture carts and rejects a missing required structured attribute", () => {
    const cart = fixture.scenarios.find((scenario) => scenario.expectedStage === "guard")?.cart;
    expect(CartSchema.safeParse(cart).success).toBe(true);
    const malformed = cart && {
      ...cart,
      lineItems: cart.lineItems.map((item, index) => index === 0
        ? { ...item, attributes: Object.fromEntries(Object.entries(item.attributes).filter(([key]) => key !== "size")) }
        : item),
    };
    expect(CartSchema.safeParse(malformed).success).toBe(false);
  });
});
