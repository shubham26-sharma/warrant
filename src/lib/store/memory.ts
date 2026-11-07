import type {
  AuditEventRecord, CartProposalRecord, DecisionRecord, HumanApprovalRecord, MandateRecord,
  PayPalOrderRecord, Store,
} from "./types";
import { AiResultSchema, type AiResult } from "../schemas/decision";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements Store {
  private readonly mandates = new Map<string, MandateRecord>();
  private readonly proposals = new Map<string, CartProposalRecord>();
  private readonly decisions = new Map<string, DecisionRecord>();
  private readonly approvals = new Map<string, HumanApprovalRecord>();
  private readonly orders = new Map<string, PayPalOrderRecord>();
  private readonly events: AuditEventRecord[] = [];
  private readonly semanticChecks = new Map<string, AiResult>();

  private semanticKey(promptVersion: string, modelName: string, mandateHash: string, cartHash: string): string {
    return [promptVersion, modelName, mandateHash, cartHash].map((part) => `${part.length}:${part}`).join("");
  }

  async getSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string): Promise<AiResult | null> {
    const result = this.semanticChecks.get(this.semanticKey(promptVersion, modelName, mandateHash, cartHash));
    return result ? copy(result) : null;
  }
  async setSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string, result: AiResult): Promise<void> {
    this.semanticChecks.set(this.semanticKey(promptVersion, modelName, mandateHash, cartHash), copy(AiResultSchema.parse(result)));
  }

  async createMandate(record: MandateRecord): Promise<MandateRecord> {
    if ([...this.mandates.values()].some((item) => item.familyId === record.familyId && item.version === record.version)) {
      throw new Error("Mandate familyId and version must be unique");
    }
    this.mandates.set(record.mandateId, copy(record));
    return copy(record);
  }
  async getMandate(id: string): Promise<MandateRecord | null> {
    const value = this.mandates.get(id);
    return value ? copy(value) : null;
  }
  async listMandatesByFamily(familyId: string): Promise<MandateRecord[]> {
    return copy([...this.mandates.values()].filter((item) => item.familyId === familyId).sort((a, b) => a.version - b.version));
  }
  async createCartProposal(record: CartProposalRecord): Promise<CartProposalRecord> {
    if (!this.mandates.has(record.mandateId)) throw new Error("Proposal mandate does not exist");
    if (this.proposals.has(record.id)) throw new Error("Proposal id must be unique");
    this.proposals.set(record.id, copy(record));
    return copy(record);
  }
  async getCartProposal(id: string): Promise<CartProposalRecord | null> {
    const value = this.proposals.get(id);
    return value ? copy(value) : null;
  }
  async createDecision(record: DecisionRecord): Promise<DecisionRecord> {
    if (!this.proposals.has(record.cartProposalId)) throw new Error("Decision proposal does not exist");
    if (this.decisions.has(record.id)) throw new Error("Decision id must be unique");
    this.decisions.set(record.id, copy(record));
    return copy(record);
  }
  async getDecision(id: string): Promise<DecisionRecord | null> {
    const value = this.decisions.get(id);
    return value ? copy(value) : null;
  }
  async createHumanApproval(record: HumanApprovalRecord): Promise<HumanApprovalRecord> {
    if (!this.decisions.has(record.decisionId)) throw new Error("Approval decision does not exist");
    if ([...this.approvals.values()].some((item) => item.decisionId === record.decisionId)) throw new Error("Decision already has an approval");
    this.approvals.set(record.id, copy(record));
    return copy(record);
  }
  async getHumanApprovalByDecision(decisionId: string): Promise<HumanApprovalRecord | null> {
    const value = [...this.approvals.values()].find((item) => item.decisionId === decisionId);
    return value ? copy(value) : null;
  }
  async createPayPalOrder(record: PayPalOrderRecord): Promise<PayPalOrderRecord> {
    if (!this.decisions.has(record.decisionId)) throw new Error("Order decision does not exist");
    if ([...this.orders.values()].some((item) => item.decisionId === record.decisionId || item.paypalOrderId === record.paypalOrderId)) {
      throw new Error("PayPal order decisionId and paypalOrderId must be unique");
    }
    this.orders.set(record.id, copy(record));
    return copy(record);
  }
  async getPayPalOrder(id: string): Promise<PayPalOrderRecord | null> {
    const value = this.orders.get(id);
    return value ? copy(value) : null;
  }
  async getPayPalOrderByDecision(decisionId: string): Promise<PayPalOrderRecord | null> {
    const value = [...this.orders.values()].find((item) => item.decisionId === decisionId);
    return value ? copy(value) : null;
  }
  async updatePayPalOrder(record: PayPalOrderRecord): Promise<PayPalOrderRecord> {
    if (!this.orders.has(record.id)) throw new Error("PayPal order does not exist");
    this.orders.set(record.id, copy(record));
    return copy(record);
  }
  async appendAuditEvent(record: Omit<AuditEventRecord, "id">): Promise<AuditEventRecord> {
    const event = { ...copy(record), id: this.events.length + 1 };
    this.events.push(event);
    return copy(event);
  }
  async listAuditEvents(): Promise<AuditEventRecord[]> {
    return copy(this.events);
  }
}
