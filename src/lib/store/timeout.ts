import { DATABASE_OPERATION_TIMEOUT_MS, withTimeout } from "../timeout";
import type { Store } from "./types";

export function withStoreTimeout(store: Store, timeoutMs = DATABASE_OPERATION_TIMEOUT_MS): Store {
  const guard = <T>(operation: Promise<T>): Promise<T> =>
    withTimeout(operation, timeoutMs, "Database request timed out");

  return {
    getSemanticCheckCache: (...args) => guard(store.getSemanticCheckCache(...args)),
    setSemanticCheckCache: (...args) => guard(store.setSemanticCheckCache(...args)),
    createMandate: (...args) => guard(store.createMandate(...args)),
    getMandate: (...args) => guard(store.getMandate(...args)),
    listMandatesByFamily: (...args) => guard(store.listMandatesByFamily(...args)),
    listMandates: (...args) => guard(store.listMandates(...args)),
    createCartProposal: (...args) => guard(store.createCartProposal(...args)),
    getCartProposal: (...args) => guard(store.getCartProposal(...args)),
    listCartProposals: (...args) => guard(store.listCartProposals(...args)),
    createDecision: (...args) => guard(store.createDecision(...args)),
    getDecision: (...args) => guard(store.getDecision(...args)),
    listDecisions: (...args) => guard(store.listDecisions(...args)),
    createHumanApproval: (...args) => guard(store.createHumanApproval(...args)),
    getHumanApprovalByDecision: (...args) => guard(store.getHumanApprovalByDecision(...args)),
    createPayPalOrder: (...args) => guard(store.createPayPalOrder(...args)),
    getPayPalOrder: (...args) => guard(store.getPayPalOrder(...args)),
    getPayPalOrderByDecision: (...args) => guard(store.getPayPalOrderByDecision(...args)),
    getPayPalOrderByPayPalId: (...args) => guard(store.getPayPalOrderByPayPalId(...args)),
    updatePayPalOrder: (...args) => guard(store.updatePayPalOrder(...args)),
    appendAuditEvent: (...args) => guard(store.appendAuditEvent(...args)),
    listAuditEvents: (...args) => guard(store.listAuditEvents(...args)),
    clearDemoData: (...args) => guard(store.clearDemoData(...args)),
  };
}

