import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAiClient, type AiClient, type StructuredOutputSchema } from "./client";
import { PRODUCTS, DEMO_MERCHANT_ID, ALTERNATE_MERCHANT_ID } from "../catalog/products";
import { MandateDraftSchema, type MandateDraft } from "../schemas/mandate";

const AttributeOutputSchema = z.object({ key: z.string(), value: z.string() }).strict();
const NullablePositiveInteger = z.number().int().nullable().transform((value) => value !== null && value > 0 ? value : null);

const CompileOutputSchema = z.object({
  maximumTotalCents: NullablePositiveInteger,
  maximumQuantity: NullablePositiveInteger,
  maximumDeliveryDays: NullablePositiveInteger,
  allowedMerchantIds: z.array(z.string()),
  requiredAttributes: z.array(AttributeOutputSchema),
  preferredBrands: z.array(z.string()),
  preferredAttributes: z.array(AttributeOutputSchema),
}).strict();

type CompileOutput = z.infer<typeof CompileOutputSchema>;

const CompileOutputModelSchema = {
  type: "object",
  properties: {
    maximumTotalCents: { type: ["integer", "null"] },
    maximumQuantity: { type: ["integer", "null"] },
    maximumDeliveryDays: { type: ["integer", "null"] },
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
  },
  required: ["maximumTotalCents", "maximumQuantity", "maximumDeliveryDays", "allowedMerchantIds", "requiredAttributes", "preferredBrands", "preferredAttributes"],
  additionalProperties: false,
} as const;

const CompilerResponseSchema: StructuredOutputSchema<CompileOutput> = {
  jsonSchema: CompileOutputModelSchema,
  parse: (value) => CompileOutputSchema.parse(value),
};

const VAGUE_CLAUSE = /\b(?:cheapest|good\s+quality|eco[- ]friendly|usual|high[- ]quality|best|reasonable)\b/gi;
const BUDGET_EXPRESSION = /(?:\$\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|dollars?)\b|\b(?:USD|maximum(?:\s+total)?|budget)\s*[:=]?\s*\$?\s*\d[\d,]*(?:\.\d{1,2})?)/i;
const QUANTITY_EXPRESSION = /\b(?:up\s+to|at\s+most|max(?:imum)?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:packs?|reams?|sheets?|units?|boxes?|items?|bottles?|cartons?)\b/i;
const DELIVERY_EXPRESSION = /\b(?:within|in|under|maximum(?:\s+of)?|max(?:imum)?)\s+\d+\s+days?\b/i;

const merchantVocabulary = [
  { id: DEMO_MERCHANT_ID, displayName: "Warrant Demo Store" },
  { id: ALTERNATE_MERCHANT_ID, displayName: "Bulk Paper Outlet" },
] as const;
const attributeVocabulary = [...new Set(PRODUCTS.flatMap((product) => Object.entries(product.attributes)
  .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  .map(([key, value]) => `${key}=${value}`)))];

function findUnresolvedClauses(text: string, output: CompileOutput): string[] {
  const clauses = [...text.matchAll(VAGUE_CLAUSE)].map(([span]) => span);
  if (output.maximumTotalCents === null || !BUDGET_EXPRESSION.test(text)) clauses.push("maximum total not stated");
  if (output.maximumQuantity === null || !QUANTITY_EXPRESSION.test(text)) clauses.push("maximum quantity not stated");
  if (output.maximumDeliveryDays === null || !DELIVERY_EXPRESSION.test(text)) clauses.push("maximum delivery days not stated");
  return [...new Set(clauses)];
}

const systemPrompt = `Compile a buyer's free-text request into a DRAFT mandate. Never invent or infer a number, merchant, or product attribute. If a numeric maximum is not explicitly stated, return null; 0 is invalid and must be returned as null. Use only the supplied merchant IDs and attribute keys/values. Map a merchant display name to its supplied ID. Map explicit product requirements such as A4 or recycled to matching attribute entries. Vague terms remain unresolved and must not be converted into invented constraints. Do not decide whether the request is ambiguous; ambiguity is derived by code.\n\nExamples (format guidance only):\nRequest: "Order 4 cartons of blue archive folders, no more than $42, within 6 days from Warrant Demo Store."\nOutput fields: maximumTotalCents=4200, maximumQuantity=4, maximumDeliveryDays=6, allowedMerchantIds=["demo-office-supplies"], requiredAttributes=[{"key":"color","value":"blue"},{"key":"type","value":"archive"}]\nRequest: "Find the cheapest desk organizers."\nOutput fields: maximumTotalCents=null, maximumQuantity=null, maximumDeliveryDays=null, allowedMerchantIds=[], requiredAttributes=[]; code marks "cheapest" unresolved and missing numeric limits unresolved.`;

export async function compileMandate(
  text: string,
  defaultCurrency: string,
  client: AiClient = getAiClient(),
): Promise<MandateDraft> {
  if (text.length > 1000) throw new RangeError("Mandate text must be at most 1000 characters");
  if (!text.trim()) throw new TypeError("Mandate text cannot be empty");
  if (!/^[A-Za-z]{3}$/.test(defaultCurrency)) throw new TypeError("Default currency must be a three-letter code");

  const userPrompt = JSON.stringify({ request: text, merchants: merchantVocabulary, allowedAttributeKeys: [...new Set(PRODUCTS.flatMap((product) => Object.keys(product.attributes)))], knownAttributeValues: attributeVocabulary });
  const output = await client.generateStructured(CompilerResponseSchema, systemPrompt, userPrompt);
  const unresolvedClauses = findUnresolvedClauses(text, output);
  const mentionedMerchants = merchantVocabulary.filter((merchant) => text.toLocaleLowerCase().includes(merchant.displayName.toLocaleLowerCase()));
  const allowedMerchantIds = output.allowedMerchantIds.filter((id) => merchantVocabulary.some((merchant) => merchant.id === id));
  const modelAttributes = output.requiredAttributes.filter((attribute) => {
    const key = attribute.key.trim().toLocaleLowerCase();
    return PRODUCTS.some((product) => Object.entries(product.attributes).some(([candidateKey, candidateValue]) =>
      candidateKey.toLocaleLowerCase() === key && candidateValue?.toLocaleLowerCase() === attribute.value.trim().toLocaleLowerCase()));
  });
  const explicitAttributes = attributeVocabulary.flatMap((pair) => {
    const [key, value] = pair.split("=", 2);
    return text.toLocaleLowerCase().includes(value.toLocaleLowerCase()) ? [{ key, value }] : [];
  });
  const explicitKeys = new Set(explicitAttributes.map((attribute) => `${attribute.key.toLocaleLowerCase()}=${attribute.value.toLocaleLowerCase()}`));
  const requiredAttributes = [...new Map([...explicitAttributes, ...modelAttributes.filter((attribute) => explicitKeys.has(`${attribute.key.toLocaleLowerCase()}=${attribute.value.toLocaleLowerCase()}`))]
    .map((attribute) => [`${attribute.key.toLocaleLowerCase()}=${attribute.value.toLocaleLowerCase()}`, attribute])).values()];
  const suggestions = [...new Map(modelAttributes.filter((attribute) => !explicitKeys.has(`${attribute.key.toLocaleLowerCase()}=${attribute.value.toLocaleLowerCase()}`))
    .map((attribute) => [`${attribute.key.toLocaleLowerCase()}=${attribute.value.toLocaleLowerCase()}`, attribute])).values()];

  const candidate = {
    mandateId: randomUUID(),
    version: 1,
    originalText: text,
    currency: defaultCurrency.toUpperCase(),
    hardConstraints: {
      maximumTotalCents: output.maximumTotalCents,
      maximumQuantity: output.maximumQuantity,
      maximumDeliveryDays: output.maximumDeliveryDays,
      allowedMerchantIds: [...new Set([
        ...allowedMerchantIds,
        ...mentionedMerchants.map((merchant) => merchant.id),
        ...(/\bdemo\s+store\s+only\b/i.test(text) ? [DEMO_MERCHANT_ID] : []),
      ])],
      requiredAttributes,
    },
    softConstraints: { preferredBrands: output.preferredBrands, preferredAttributes: output.preferredAttributes },
    ambiguity: { hasAmbiguity: unresolvedClauses.length > 0, unresolvedClauses },
    suggestions,
    status: "DRAFT" as const,
    confirmedAt: null,
  };
  return MandateDraftSchema.parse(candidate);
}
