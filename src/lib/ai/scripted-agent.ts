import { buildCart } from "../catalog/products";
import type { AgentProposal } from "./agent";

export type ScriptedCase = "compliant" | "overbudget-premium" | "mislabeled" | "optional-injection";

const cases: Record<ScriptedCase, { productId: string; quantity: number; rationale: string }> = {
  compliant: { productId: "a4-recycled-standard", quantity: 5, rationale: "Matches the requested recycled A4 paper." },
  "overbudget-premium": { productId: "a4-recycled-premium", quantity: 5, rationale: "Premium option for comparison; authorization will check the limit." },
  mislabeled: { productId: "a4-recycled-mislabeled", quantity: 5, rationale: "Listing text conflicts with its structured size." },
  "optional-injection": { productId: "a4-recycled-injection-listing", quantity: 5, rationale: "Adversarial product text fixture." },
};

export function runScriptedAgent(scenario: ScriptedCase = "compliant"): AgentProposal {
  const selected = cases[scenario];
  return { cart: buildCart([{ productId: selected.productId, quantity: selected.quantity }]), rationale: selected.rationale };
}
