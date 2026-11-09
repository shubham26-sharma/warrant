import { createHmac } from "node:crypto";
import { canonicalJson, chainHash } from "../hash";
import { getDbStoreTimeoutMs, TimeoutError } from "../timeout";
import type { AuditEventRecord, Store } from "../store/types";

let appendQueue: Promise<void> = Promise.resolve();

export function getAuditAppendTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return getDbStoreTimeoutMs(env);
}

function hashEvent(prevHash: string, type: string, payload: unknown, timestamp: string): string {
  const secret = process.env.AUDIT_HMAC_SECRET;
  const value = canonicalJson({ prevHash, eventType: type, payload, timestamp });
  if (secret) return createHmac("sha256", secret).update(value, "utf8").digest("hex");
  return chainHash(prevHash, type, payload, timestamp);
}

async function appendLocked(store: Store, type: string, payload: unknown): Promise<AuditEventRecord> {
  const deadlineAt = Date.now() + getAuditAppendTimeoutMs();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const events = await store.listAuditEvents();
    const last = events.at(-1);
    const prevHash = last?.hash ?? "";
    const createdAt = new Date().toISOString();
    const hash = hashEvent(prevHash, type, payload, createdAt);
    try {
      return await store.appendAuditEvent({ type, payload, prevHash, hash, createdAt });
    } catch (error) {
      if (
        error instanceof TimeoutError ||
        attempt === 4 ||
        Date.now() >= deadlineAt ||
        !(error instanceof Error) ||
        !error.message.includes("Audit chain changed")
      ) {
        throw error;
      }
    }
  }
  throw new Error("Could not append audit event");
}

export function appendEvent(store: Store, type: string, payload: unknown): Promise<AuditEventRecord> {
  const operation = appendQueue.then(() => appendLocked(store, type, payload));
  appendQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function verifyChain(store: Store): Promise<{ ok: boolean; brokenAtId?: number }> {
  const events = await store.listAuditEvents();
  let previous = "";
  for (const event of events) {
    if (event.prevHash !== previous || hashEvent(previous, event.type, event.payload, event.createdAt) !== event.hash) {
      return { ok: false, brokenAtId: event.id };
    }
    previous = event.hash;
  }
  return { ok: true };
}
