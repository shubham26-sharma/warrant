import type { Cart } from "../schemas/cart";
import type { Mandate } from "../schemas/mandate";
import type { AiResult, RuleResult, Verdict } from "../schemas/decision";

export type MandateRecord = Mandate & { familyId: string; hash: string };
export type CartProposalRecord = {
  id: string; mandateId: string; cart: Cart; cartHash: string; source: "AGENT_LIVE" | "AGENT_SCRIPTED";
};
export type DecisionRecord = {
  id: string; cartProposalId: string; mandateHash: string; cartHash: string; verdict: Verdict;
  ruleResults: RuleResult[]; aiResult: AiResult | null; reasons: string[]; createdAt: string;
};
export type HumanApprovalRecord = { id: string; decisionId: string; note: string; createdAt: string };
export type PayPalOrderRecord = {
  id: string; decisionId: string; paypalOrderId: string; status: string; totalCents: number;
  currency: string; captureId: string | null; createdAt: string;
};
export type AuditEventRecord = {
  id: number; type: string; payload: unknown; prevHash: string; hash: string; createdAt: string;
};
export type SemanticCheckCacheRecord = {
  promptVersion: string; modelName: string; mandateHash: string; cartHash: string; result: AiResult;
};

export interface Store {
  getSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string): Promise<AiResult | null>;
  setSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string, result: AiResult): Promise<void>;
  createMandate(record: MandateRecord): Promise<MandateRecord>;
  getMandate(id: string): Promise<MandateRecord | null>;
  listMandatesByFamily(familyId: string): Promise<MandateRecord[]>;
  createCartProposal(record: CartProposalRecord): Promise<CartProposalRecord>;
  getCartProposal(id: string): Promise<CartProposalRecord | null>;
  createDecision(record: DecisionRecord): Promise<DecisionRecord>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  createHumanApproval(record: HumanApprovalRecord): Promise<HumanApprovalRecord>;
  getHumanApprovalByDecision(decisionId: string): Promise<HumanApprovalRecord | null>;
  createPayPalOrder(record: PayPalOrderRecord): Promise<PayPalOrderRecord>;
  getPayPalOrder(id: string): Promise<PayPalOrderRecord | null>;
  getPayPalOrderByDecision(decisionId: string): Promise<PayPalOrderRecord | null>;
  updatePayPalOrder(record: PayPalOrderRecord): Promise<PayPalOrderRecord>;
  appendAuditEvent(record: Omit<AuditEventRecord, "id">): Promise<AuditEventRecord>;
  listAuditEvents(): Promise<AuditEventRecord[]>;
}
