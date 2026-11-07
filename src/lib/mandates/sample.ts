import { confirmMandate } from "./confirm-mandate";
import type { Store } from "../store/types";

export const SAMPLE_FAMILY_ID = "550e8400-e29b-41d4-a716-446655440000";

export function sampleMandateDraft() {
  return {
    mandateId: SAMPLE_FAMILY_ID,
    version: 1,
    originalText: "Reorder up to 5 packs of A4 recycled paper, max $60 including delivery and tax, delivered within 3 days, Warrant Demo Store only.",
    currency: "USD",
    hardConstraints: {
      maximumTotalCents: 6000, maximumQuantity: 5, maximumDeliveryDays: 3,
      allowedMerchantIds: ["demo-office-supplies"],
      requiredAttributes: [{ key: "size", value: "A4" }, { key: "material", value: "recycled" }],
    },
    softConstraints: { preferredBrands: [], preferredAttributes: [] },
    ambiguity: { hasAmbiguity: false, unresolvedClauses: [] },
    status: "DRAFT" as const,
    confirmedAt: null,
  };
}

export async function seedSampleMandate(store: Store) {
  const existing = (await store.listMandatesByFamily(SAMPLE_FAMILY_ID)).find((mandate) => mandate.status === "CONFIRMED");
  if (existing) return existing;
  const record = confirmMandate(sampleMandateDraft(), {});
  return store.createMandate(record);
}
