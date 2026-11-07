import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support NaN or Infinity");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined || typeof record[key] === "function") {
        throw new TypeError(`Canonical JSON does not support ${key}`);
      }
      result[key] = normalize(record[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface ChainEvent {
  type: string;
  payload: unknown;
  timestamp: string;
  prevHash: string;
  hash: string;
}

export function chainHash(prevHash: string, eventType: string, payload: unknown, timestamp: string): string {
  return sha256Hex(canonicalJson({ prevHash, eventType, payload, timestamp }));
}

export function verifyHashChain(events: readonly ChainEvent[], initialHash = ""): boolean {
  let previous = initialHash;
  for (const event of events) {
    if (event.prevHash !== previous || chainHash(previous, event.type, event.payload, event.timestamp) !== event.hash) return false;
    previous = event.hash;
  }
  return true;
}
