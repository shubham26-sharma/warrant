import { z } from "zod";

const AttributeSchema = z.object({ key: z.string().min(1), value: z.string().min(1) });
const AttributeSuggestionSchema = AttributeSchema;

export const MandateSchema = z.object({
  mandateId: z.uuid(),
  version: z.number().int().min(1),
  originalText: z.string(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  hardConstraints: z.object({
    maximumTotalCents: z.number().int().positive(),
    maximumQuantity: z.number().int().positive(),
    maximumDeliveryDays: z.number().int().positive(),
    allowedMerchantIds: z.array(z.string().min(1)),
    requiredAttributes: z.array(AttributeSchema),
  }),
  softConstraints: z.object({
    preferredBrands: z.array(z.string()),
    preferredAttributes: z.array(AttributeSchema),
  }),
  ambiguity: z.object({
    hasAmbiguity: z.boolean(),
    unresolvedClauses: z.array(z.string()),
  }).superRefine((ambiguity, ctx) => {
    if (ambiguity.hasAmbiguity && ambiguity.unresolvedClauses.length === 0) {
      ctx.addIssue({ code: "custom", message: "Ambiguous mandates must list unresolved clauses" });
    }
  }),
  status: z.enum(["DRAFT", "CONFIRMED"]),
  confirmedAt: z.iso.datetime().nullable(),
}).superRefine((mandate, ctx) => {
  if (mandate.status === "CONFIRMED" && mandate.confirmedAt === null) {
    ctx.addIssue({ code: "custom", path: ["confirmedAt"], message: "Confirmed mandates require confirmedAt" });
  }
  if (mandate.status === "CONFIRMED" && mandate.ambiguity.hasAmbiguity) {
    ctx.addIssue({ code: "custom", path: ["ambiguity"], message: "Ambiguous mandates cannot be confirmed" });
  }
});

export const MandateDraftSchema = z.object({
  mandateId: MandateSchema.shape.mandateId,
  version: MandateSchema.shape.version,
  originalText: MandateSchema.shape.originalText,
  currency: MandateSchema.shape.currency,
  hardConstraints: MandateSchema.shape.hardConstraints.extend({
    maximumTotalCents: z.number().int().positive().nullable(),
    maximumQuantity: z.number().int().positive().nullable(),
    maximumDeliveryDays: z.number().int().positive().nullable(),
  }),
  softConstraints: MandateSchema.shape.softConstraints,
  ambiguity: MandateSchema.shape.ambiguity,
  suggestions: z.array(AttributeSuggestionSchema),
  status: z.literal("DRAFT"),
  confirmedAt: z.null(),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateDraft = z.infer<typeof MandateDraftSchema>;
