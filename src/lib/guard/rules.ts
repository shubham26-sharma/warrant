import type { Cart } from "../schemas/cart";
import type { Mandate } from "../schemas/mandate";
import type { RuleResult, Verdict } from "../schemas/decision";
import { maxVerdict } from "./combine";
import { findInjectionMarkers } from "./injection-markers";

function result(
  ruleId: string,
  mandateClause: string,
  cartPath: string,
  passed: boolean,
  severity: Verdict,
  message: string,
): RuleResult {
  return { ruleId, mandateClause, cartPath, passed, severity, message };
}

export function checkCurrency(mandate: Mandate, cart: Cart): RuleResult {
  const passed = mandate.currency.toUpperCase() === cart.currency.toUpperCase();
  return result("CURRENCY_MATCH", `Use ${mandate.currency} currency`, "cart.currency", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Currency matches the mandate." : "Cart currency does not match the mandate.");
}

export function checkMerchant(mandate: Mandate, cart: Cart): RuleResult {
  const passed = mandate.hardConstraints.allowedMerchantIds.includes(cart.merchantId);
  return result("MERCHANT_ALLOWED", "Use an approved merchant", "cart.merchantId", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Merchant is allowed." : "Merchant is not on the mandate's approved list.");
}

export function checkTotalBudget(mandate: Mandate, cart: Cart): RuleResult {
  const maximum = mandate.hardConstraints.maximumTotalCents;
  const passed = cart.totalCents <= maximum;
  return result("TOTAL_WITHIN_BUDGET", `Maximum total is ${maximum} cents`, "cart.totalCents", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Cart total is within the maximum." : "Cart total exceeds the maximum.");
}

export function checkMaximumQuantity(mandate: Mandate, cart: Cart): RuleResult {
  const quantity = cart.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  const maximum = mandate.hardConstraints.maximumQuantity;
  const passed = Number.isSafeInteger(quantity) && quantity <= maximum;
  return result("QUANTITY_WITHIN_LIMIT", `Maximum quantity is ${maximum}`, "cart.lineItems[].quantity", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Total quantity is within the maximum." : "Total quantity exceeds the maximum.");
}

export function checkDeliveryDays(mandate: Mandate, cart: Cart): RuleResult {
  const days = cart.deliveryDays;
  const maximum = mandate.hardConstraints.maximumDeliveryDays;
  if (days === null) {
    return result("DELIVERY_KNOWN_AND_WITHIN_LIMIT", `Deliver within ${maximum} days`, "cart.deliveryDays", false,
      "REVIEW", "Delivery estimate is missing.");
  }
  const passed = days <= maximum;
  return result("DELIVERY_KNOWN_AND_WITHIN_LIMIT", `Deliver within ${maximum} days`, "cart.deliveryDays", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Delivery is within the maximum." : "Delivery exceeds the maximum number of days.");
}

export function checkRequiredAttributes(mandate: Mandate, cart: Cart): RuleResult[] {
  return mandate.hardConstraints.requiredAttributes.flatMap(({ key, value }) =>
    cart.lineItems.map((item, index) => {
      const actual = item.attributes[key];
      const path = `cart.lineItems[${index}].attributes.${key}`;
      if (typeof actual !== "string" || actual.trim() === "") {
        return result("REQUIRED_ATTRIBUTE_PRESENT", `Require ${key}=${value}`, path, false,
          "REVIEW", `Required attribute '${key}' is missing or unknown.`);
      }
      const passed = actual.trim().toLowerCase() === value.trim().toLowerCase();
      return result("REQUIRED_ATTRIBUTE_MATCH", `Require ${key}=${value}`, path, passed,
        passed ? "APPROVE" : "BLOCK", passed ? `Required attribute '${key}' matches.` : `Required attribute '${key}' conflicts with the mandate.`);
    }),
  );
}

export function checkCartArithmetic(cart: Cart): RuleResult {
  const computedSubtotal = cart.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const validSubtotal = Number.isSafeInteger(computedSubtotal) && computedSubtotal === cart.subtotalCents;
  const computedTotal = cart.subtotalCents + cart.shippingCents + cart.taxCents;
  const validTotal = Number.isSafeInteger(computedTotal) && computedTotal === cart.totalCents;
  const passed = validSubtotal && validTotal;
  return result("CART_ARITHMETIC_CONSISTENT", "Cart totals must equal line items and fees", "cart.subtotalCents/cart.totalCents", passed,
    passed ? "APPROVE" : "BLOCK", passed ? "Cart arithmetic is consistent." : "Cart arithmetic does not match its line items or fees.");
}

export function checkSizeTokenConflict(cart: Cart): RuleResult[] {
  return cart.lineItems.flatMap((item, index) => {
    const text = [item.title, item.description ?? ""].join(" ");
    const tokens = [...text.matchAll(/\bA\d+\b/gi)].map(([token]) => token.toUpperCase());
    const structuredSize = item.attributes.size;
    if (typeof structuredSize !== "string" || tokens.length === 0) return [];
    const conflicts = [...new Set(tokens)].filter((token) => token !== structuredSize.trim().toUpperCase());
    if (conflicts.length === 0) return [];
    return [result("SIZE_TEXT_CONFLICT", `Product size is ${structuredSize}`, `cart.lineItems[${index}].title/description`, false,
      "REVIEW", `Product text mentions ${conflicts.join(", ")} but structured size is ${structuredSize}.`)];
  });
}

export function checkPromptInjection(cart: Cart): RuleResult[] {
  return cart.lineItems.flatMap((item, index) => {
    const markers = findInjectionMarkers(`${item.title}\n${item.description ?? ""}`);
    if (markers.length === 0) return [];
    return [result("UNTRUSTED_TEXT_MARKER", "Product text is untrusted data", `cart.lineItems[${index}].title/description`, false,
      "REVIEW", `Product text contains instruction-like marker(s): ${markers.join(", ")}.`)];
  });
}

export function evaluateDeterministicRules(mandate: Mandate, cart: Cart): RuleResult[] {
  return [
    checkCurrency(mandate, cart),
    checkMerchant(mandate, cart),
    checkTotalBudget(mandate, cart),
    checkMaximumQuantity(mandate, cart),
    checkDeliveryDays(mandate, cart),
    ...checkRequiredAttributes(mandate, cart),
    checkCartArithmetic(cart),
    ...checkSizeTokenConflict(cart),
    ...checkPromptInjection(cart),
  ];
}

export function deterministicVerdict(rules: readonly RuleResult[]): Verdict {
  return rules.reduce<Verdict>((verdict, rule) => maxVerdict(verdict, rule.severity), "APPROVE");
}
