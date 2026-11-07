import { canonicalJson, sha256Hex } from "../hash";
import { CartSchema, type Cart } from "../schemas/cart";
import type { Store } from "../store/types";

const authorizationBrand: unique symbol = Symbol("OrderAuthorization");
export type OrderAuthorization = {
  decisionId: string;
  mandateId: string;
  cart: Cart;
  totalCents: number;
  currency: string;
  readonly [authorizationBrand]: true;
};

export class OrderAuthorizationError extends Error {
  constructor(message: string) { super(message); this.name = "OrderAuthorizationError"; }
}

export async function authorizeOrder(store: Store, decisionId: string): Promise<OrderAuthorization> {
  const decision = await store.getDecision(decisionId);
  if (!decision) throw new OrderAuthorizationError("Decision was not found");
  if (decision.verdict === "BLOCK") throw new OrderAuthorizationError("Blocked decisions cannot create PayPal orders");
  if (decision.verdict === "REVIEW" && !await store.getHumanApprovalByDecision(decisionId)) {
    throw new OrderAuthorizationError("A REVIEW decision requires manager approval");
  }
  const proposal = await store.getCartProposal(decision.cartProposalId);
  if (!proposal) throw new OrderAuthorizationError("Cart proposal was not found");
  const cart = CartSchema.parse(proposal.cart);
  if (sha256Hex(canonicalJson(cart)) !== decision.cartHash || proposal.cartHash !== decision.cartHash) {
    throw new OrderAuthorizationError("Cart changed after the decision");
  }
  const mandate = await store.getMandate(proposal.mandateId);
  if (!mandate || mandate.status !== "CONFIRMED") throw new OrderAuthorizationError("A confirmed mandate is required");
  const { familyId, hash, ...mandateData } = mandate;
  void familyId;
  void hash;
  if (sha256Hex(canonicalJson(mandateData)) !== decision.mandateHash) {
    throw new OrderAuthorizationError("Mandate changed after the decision");
  }
  const family = await store.listMandatesByFamily(mandate.familyId);
  const latest = family.filter((item) => item.status === "CONFIRMED").sort((a, b) => b.version - a.version)[0];
  if (!latest || latest.mandateId !== mandate.mandateId) throw new OrderAuthorizationError("A newer confirmed mandate version exists");
  if (await store.getPayPalOrderByDecision(decisionId)) throw new OrderAuthorizationError("An order already exists for this decision");

  return {
    decisionId,
    mandateId: mandate.mandateId,
    cart,
    totalCents: cart.totalCents,
    currency: cart.currency,
    [authorizationBrand]: true,
  };
}
