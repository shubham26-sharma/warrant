import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAiClient, type AiClient, type StructuredOutputSchema } from "./client";
import { MandateSchema, type Mandate } from "../schemas/mandate";

const AttributeOutputSchema = z.object({ key: z.string(), value: z.string() }).strict();

const CompileOutputSchema = z.object({
  maximumTotalCents: z.number().int().nonnegative().optional(),
  maximumQuantity: z.number().int().positive().optional(),
  maximumDeliveryDays: z.number().int().positive().optional(),
  allowedMerchantIds: z.array(z.string()),
  requiredAttributes: z.array(AttributeOutputSchema),
  preferredBrands: z.array(z.string()),
  preferredAttributes: z.array(AttributeOutputSchema),
  unresolvedClauses: z.array(z.string()),
}).strict();

type CompileOutput = z.infer<typeof CompileOutputSchema>;

const CompileOutputModelSchema = {
  type: "object",
  properties: {
    maximumTotalCents: { type: "integer" },
    maximumQuantity: { type: "integer" },
    maximumDeliveryDays: { type: "integer" },
    allowedMerchantIds: { type: "array", items: { type: "string" } },
    requiredAttributes: {
      type: "array",
      items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
    },
    preferredBrands: { type: "array", items: { type: "string" } },
    preferredAttributes: {
      type: "array",
      items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
    },
    unresolvedClauses: { type: "array", items: { type: "string" } },
  },
  required: ["allowedMerchantIds", "requiredAttributes", "preferredBrands", "preferredAttributes", "unresolvedClauses"],
  additionalProperties: false,
} as const;

const CompilerResponseSchema: StructuredOutputSchema<CompileOutput> = {
  jsonSchema: CompileOutputModelSchema,
  parse: (value) => CompileOutputSchema.parse(value),
};

const VAGUE_CLAUSE = /\b(?:cheapest|good\s+quality|eco[- ]friendly|usual|high[- ]quality|best|reasonable)\b/gi;
const QUANTITY_EXPRESSION = /\b(?:(?:up\s+to|at\s+most|max(?:imum)?)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:packs?|reams?|sheets?|units?|boxes?|items?|bottles?|cartons?)?\b/i;
const BUDGET_EXPRESSION = /(?:\$\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|dollars?)\b|\b(?:USD|maximum(?:\s+total)?|budget)\s*[:=]?\s*\$?\s*\d[\d,]*(?:\.\d{1,2})?)/i;
const DELIVERY_EXPRESSION = /\b(?:within|in|under|maximum(?:\s+of)?|max(?:imum)?)\s+\d+\s+days?\b/i;

function missingRequirementSpan(text: string, present: boolean): string[] {
  return present ? [] : [text.trim()];
}

function hasQuantity(text: string): boolean {
  return QUANTITY_EXPRESSION.test(text) && /\b(?:pack|ream|sheet|unit|box|item|bottle|carton|quantity|qty|reorder|buy|order|purchase|get)\w*/i.test(text);
}

function findDeterministicAmbiguities(text: string, output: CompileOutput): string[] {
  const clauses = [...text.matchAll(VAGUE_CLAUSE)].map(([span]) => span);
  clauses.push(...output.unresolvedClauses.filter((span) => span.length > 0 && text.includes(span)));

  const hasBudget = BUDGET_EXPRESSION.test(text);
  const quantityPresent = hasQuantity(text);
  const hasDeliveryLimit = DELIVERY_EXPRESSION.test(text);
  const hasMerchant = output.allowedMerchantIds.length > 0 || /\bdemo\s+store\s+only\b/i.test(text);
  const hasSpecificAttributes = output.requiredAttributes.length > 0;

  clauses.push(...missingRequirementSpan(text, hasBudget));
  clauses.push(...missingRequirementSpan(text, quantityPresent));
  clauses.push(...missingRequirementSpan(text, hasDeliveryLimit));
  clauses.push(...missingRequirementSpan(text, hasMerchant));
  clauses.push(...missingRequirementSpan(text, hasSpecificAttributes));

  return [...new Set(clauses.filter(Boolean))];
}

const systemPrompt = `Compile the buyer's free-text purchase request into concrete mandate fields. Never guess missing values. Use the known merchant ids only: demo-office-supplies (Warrant Demo Store, a demo merchant) and bulk-paper-outlet. Leave any unprovided numeric maximum absent. Return vague language and unresolved clauses as exact substrings from the request. If a requirement is missing, omit its numeric value and include the full request text as an unresolved span. Return empty arrays for list fields with no known values.`;

export async function compileMandate(
  text: string,
  defaultCurrency: string,
  client: AiClient = getAiClient(),
): Promise<Mandate> {
  if (text.length > 1000) throw new RangeError("Mandate text must be at most 1000 characters");
  if (!text.trim()) throw new TypeError("Mandate text cannot be empty");
  if (!/^[A-Za-z]{3}$/.test(defaultCurrency)) throw new TypeError("Default currency must be a three-letter code");

  const output = await client.generateStructured(CompilerResponseSchema, systemPrompt, text);
  const unresolvedClauses = findDeterministicAmbiguities(text, output);

  const candidate = {
    mandateId: randomUUID(),
    version: 1,
    originalText: text,
    currency: defaultCurrency.toUpperCase(),
    hardConstraints: {
      maximumTotalCents: output.maximumTotalCents ?? 0,
      maximumQuantity: output.maximumQuantity ?? 1,
      maximumDeliveryDays: output.maximumDeliveryDays ?? 1,
      allowedMerchantIds: /\bdemo\s+store\s+only\b/i.test(text) && output.allowedMerchantIds.length === 0
        ? ["demo-office-supplies"]
        : output.allowedMerchantIds,
      requiredAttributes: output.requiredAttributes,
    },
    softConstraints: {
      preferredBrands: output.preferredBrands,
      preferredAttributes: output.preferredAttributes,
    },
    ambiguity: { hasAmbiguity: unresolvedClauses.length > 0, unresolvedClauses },
    status: "DRAFT" as const,
    confirmedAt: null,
  };
  return MandateSchema.parse(candidate);
}
