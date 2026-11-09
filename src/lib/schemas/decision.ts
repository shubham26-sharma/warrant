import { z } from "zod";

export const VerdictSchema = z.enum(["APPROVE", "REVIEW", "BLOCK"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RuleResultSchema = z.object({
  ruleId: z.string(),
  mandateClause: z.string(),
  cartPath: z.string(),
  passed: z.boolean(),
  severity: VerdictSchema,
  message: z.string(),
});
export type RuleResult = z.infer<typeof RuleResultSchema>;

export const AiResultSchema = z.object({
  verdict: VerdictSchema,
  reasons: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
  code: z.string().optional(),
});
export type AiResult = z.infer<typeof AiResultSchema>;

export const DecisionSchema = z.object({
  decisionId: z.uuid(),
  mandateHash: z.string(),
  cartHash: z.string(),
  verdict: VerdictSchema,
  ruleResults: z.array(RuleResultSchema),
  aiResult: AiResultSchema.nullable(),
  reasons: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;
