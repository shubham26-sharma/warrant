import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { AiResultSchema, VerdictSchema } from "../schemas/decision";
import { CartSchema } from "../schemas/cart";
import { MandateSchema } from "../schemas/mandate";
import type { AuditEventRecord, CartProposalRecord, DecisionRecord, HumanApprovalRecord, MandateRecord, PayPalOrderRecord, Store } from "./types";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const iso = (value: Date): string => value.toISOString();

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient) {}

  private mandate(row: { id: string; familyId: string; version: number; text: string; constraints: Prisma.JsonValue; hash: string; status: "DRAFT" | "CONFIRMED"; confirmedAt: Date | null }): MandateRecord {
    const details = row.constraints as { currency: string; hardConstraints: unknown; softConstraints: unknown; ambiguity: unknown };
    return {
      ...MandateSchema.parse({ mandateId: row.id, version: row.version, originalText: row.text, currency: details.currency,
        hardConstraints: details.hardConstraints, softConstraints: details.softConstraints, ambiguity: details.ambiguity,
        status: row.status, confirmedAt: row.confirmedAt?.toISOString() ?? null }),
      familyId: row.familyId, hash: row.hash,
    };
  }
  private order(row: { id: string; decisionId: string; paypalOrderId: string; status: string; totalCents: number; currency: string; captureId: string | null; createdAt: Date }): PayPalOrderRecord {
    return { ...row, createdAt: iso(row.createdAt) };
  }
  private decision(row: { id: string; cartProposalId: string; mandateHash: string; cartHash: string; verdict: string; ruleResults: Prisma.JsonValue; aiResult: Prisma.JsonValue | null; reasons: Prisma.JsonValue; createdAt: Date }): DecisionRecord {
    return { id: row.id, cartProposalId: row.cartProposalId, mandateHash: row.mandateHash, cartHash: row.cartHash,
      verdict: VerdictSchema.parse(row.verdict), ruleResults: row.ruleResults as unknown as DecisionRecord["ruleResults"],
      aiResult: row.aiResult === null ? null : AiResultSchema.parse(row.aiResult), reasons: row.reasons as string[], createdAt: iso(row.createdAt) };
  }

  async getSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string) {
    const row = await this.prisma.semanticCache.findUnique({ where: { promptVersion_modelName_mandateHash_cartHash: { promptVersion, modelName, mandateHash, cartHash } } });
    return row ? AiResultSchema.parse(row.result) : null;
  }
  async setSemanticCheckCache(promptVersion: string, modelName: string, mandateHash: string, cartHash: string, result: import("../schemas/decision").AiResult): Promise<void> {
    const parsed = AiResultSchema.parse(result);
    await this.prisma.semanticCache.upsert({
      where: { promptVersion_modelName_mandateHash_cartHash: { promptVersion, modelName, mandateHash, cartHash } },
      create: { promptVersion, modelName, mandateHash, cartHash, result: json(parsed) },
      update: { result: json(parsed) },
    });
  }
  async createMandate(record: MandateRecord): Promise<MandateRecord> {
    const m = MandateSchema.parse(record);
    const row = await this.prisma.mandate.create({ data: { id: m.mandateId, familyId: record.familyId, version: m.version, text: m.originalText,
      constraints: json({ currency: m.currency, hardConstraints: m.hardConstraints, softConstraints: m.softConstraints, ambiguity: m.ambiguity }),
      hash: record.hash, status: m.status, confirmedAt: m.confirmedAt ? new Date(m.confirmedAt) : null } });
    return this.mandate(row);
  }
  async getMandate(id: string) { const row = await this.prisma.mandate.findUnique({ where: { id } }); return row ? this.mandate(row) : null; }
  async listMandatesByFamily(familyId: string) { return (await this.prisma.mandate.findMany({ where: { familyId }, orderBy: { version: "asc" } })).map((row) => this.mandate(row)); }
  async listMandates() { return (await this.prisma.mandate.findMany({ orderBy: [{ familyId: "asc" }, { version: "asc" }] })).map((row) => this.mandate(row)); }
  async createCartProposal(record: CartProposalRecord) {
    const row = await this.prisma.cartProposal.create({ data: { ...record, cart: json(CartSchema.parse(record.cart)) } });
    return { ...record, cart: CartSchema.parse(row.cart) };
  }
  async getCartProposal(id: string) {
    const row = await this.prisma.cartProposal.findUnique({ where: { id } });
    return row ? { id: row.id, mandateId: row.mandateId, cart: CartSchema.parse(row.cart), cartHash: row.cartHash, source: row.source } : null;
  }
  async listCartProposals() {
    return (await this.prisma.cartProposal.findMany()).map((row) => ({ id: row.id, mandateId: row.mandateId, cart: CartSchema.parse(row.cart), cartHash: row.cartHash, source: row.source }));
  }
  async createDecision(record: DecisionRecord) {
    const row = await this.prisma.decision.create({ data: { ...record, verdict: VerdictSchema.parse(record.verdict), ruleResults: json(record.ruleResults),
      aiResult: record.aiResult ? json(AiResultSchema.parse(record.aiResult)) : Prisma.JsonNull, reasons: json(record.reasons), createdAt: new Date(record.createdAt) } });
    return this.decision(row);
  }
  async getDecision(id: string) { const row = await this.prisma.decision.findUnique({ where: { id } }); return row ? this.decision(row) : null; }
  async listDecisions() { return (await this.prisma.decision.findMany({ orderBy: { createdAt: "desc" } })).map((row) => this.decision(row)); }
  async createHumanApproval(record: HumanApprovalRecord) {
    const row = await this.prisma.humanApproval.create({ data: { ...record, createdAt: new Date(record.createdAt) } });
    return { id: row.id, decisionId: row.decisionId, note: row.note, createdAt: iso(row.createdAt) };
  }
  async getHumanApprovalByDecision(decisionId: string) {
    const row = await this.prisma.humanApproval.findUnique({ where: { decisionId } });
    return row ? { id: row.id, decisionId: row.decisionId, note: row.note, createdAt: iso(row.createdAt) } : null;
  }
  async createPayPalOrder(record: PayPalOrderRecord) {
    const row = await this.prisma.payPalOrder.create({ data: { ...record, createdAt: new Date(record.createdAt) } });
    return this.order(row);
  }
  async getPayPalOrder(id: string) { const row = await this.prisma.payPalOrder.findUnique({ where: { id } }); return row ? this.order(row) : null; }
  async getPayPalOrderByDecision(decisionId: string) { const row = await this.prisma.payPalOrder.findUnique({ where: { decisionId } }); return row ? this.order(row) : null; }
  async getPayPalOrderByPayPalId(paypalOrderId: string) { const row = await this.prisma.payPalOrder.findUnique({ where: { paypalOrderId } }); return row ? this.order(row) : null; }
  async updatePayPalOrder(record: PayPalOrderRecord) {
    const row = await this.prisma.payPalOrder.update({ where: { id: record.id }, data: { status: record.status, captureId: record.captureId } });
    return this.order(row);
  }
  async appendAuditEvent(record: Omit<AuditEventRecord, "id">) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(427832992)`;
      const last = await tx.auditEvent.findFirst({ orderBy: { id: "desc" } });
      if ((last?.hash ?? "") !== record.prevHash) throw new Error("Audit chain changed during append; retry with the latest tail");
      const row = await tx.auditEvent.create({ data: { ...record, payload: json(record.payload), createdAt: new Date(record.createdAt) } });
      return { id: row.id, type: row.type, payload: row.payload, prevHash: row.prevHash, hash: row.hash, createdAt: iso(row.createdAt) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async listAuditEvents(): Promise<AuditEventRecord[]> {
    return (await this.prisma.auditEvent.findMany({ orderBy: { id: "asc" } })).map((row) => ({ id: row.id, type: row.type, payload: row.payload, prevHash: row.prevHash, hash: row.hash, createdAt: iso(row.createdAt) }));
  }
  async clearDemoData(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payPalOrder.deleteMany(); await tx.humanApproval.deleteMany(); await tx.decision.deleteMany();
      await tx.cartProposal.deleteMany(); await tx.auditEvent.deleteMany(); await tx.semanticCache.deleteMany(); await tx.mandate.deleteMany();
    });
  }
}
