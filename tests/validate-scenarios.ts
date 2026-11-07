import assert from "node:assert/strict";
import fixture from "./fixtures/scenarios.json";
import { CartSchema } from "../src/lib/schemas/cart";
import { MandateSchema } from "../src/lib/schemas/mandate";
import { VerdictSchema } from "../src/lib/schemas/decision";

const { baseMandate, scenarios } = fixture;
assert.equal(scenarios.length, 24, "expected exactly 24 scenarios");
assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length, "scenario ids must be unique");
assert.equal(MandateSchema.safeParse(baseMandate).success, true, "baseMandate must parse");

const categories = new Set(scenarios.map(({ category }) => category));
assert.equal(categories.size, 6, "expected six categories");
for (const category of categories) {
  assert.equal(scenarios.filter((scenario) => scenario.category === category).length, 4, `${category} must have four cases`);
}

assert.equal(scenarios.filter(({ split }) => split === "development").length, 16);
assert.equal(scenarios.filter(({ split }) => split === "held_out").length, 8);
assert.ok(scenarios.every(({ expectedStage }) => expectedStage === "guard" || expectedStage === "compiler"));
assert.equal(scenarios.filter(({ expectedStage }) => expectedStage === "guard").length, 20);
assert.equal(scenarios.filter(({ expectedStage }) => expectedStage === "compiler").length, 4);

for (const scenario of scenarios) {
  if (scenario.expectedStage === "guard") {
    const parsedCart = CartSchema.safeParse(scenario.cart);
    assert.equal(parsedCart.success, true, `${scenario.id}: cart must parse`);
    if (parsedCart.success) {
      const cart = parsedCart.data;
      const subtotal = cart.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      assert.equal(cart.subtotalCents, subtotal, `${scenario.id}: subtotal arithmetic`);
      assert.equal(cart.totalCents, cart.subtotalCents + cart.shippingCents + cart.taxCents, `${scenario.id}: total arithmetic`);
    }
    assert.equal(VerdictSchema.safeParse(scenario.expected).success, true, `${scenario.id}: expected verdict`);
  } else {
    assert.equal(typeof scenario.mandateText, "string", `${scenario.id}: compiler case needs mandateText`);
    assert.equal(scenario.expected, "AMBIGUOUS", `${scenario.id}: compiler expectation must be AMBIGUOUS`);
  }
}

console.log(`Scenarios: ${scenarios.length}; development: 16; held_out: 8; guard: ${scenarios.filter(({ expectedStage }) => expectedStage === "guard").length}; compiler: ${scenarios.filter(({ expectedStage }) => expectedStage === "compiler").length}`);
