import { describe, expect, it } from "vitest";
import { canonicalJson, chainHash, sha256Hex, verifyHashChain, type ChainEvent } from "../src/lib/hash";

describe("canonical JSON and audit hashing", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] })).toBe(
      canonicalJson({ list: [2, 1], a: { b: 3, y: 2 }, z: 1 }),
    );
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("rejects unsupported values", () => {
    expect(() => canonicalJson({ x: undefined })).toThrow();
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: () => 0 })).toThrow();
  });

  it("changes the digest when a value changes", () => {
    expect(sha256Hex(canonicalJson({ amount: 5 }))).not.toBe(sha256Hex(canonicalJson({ amount: 6 })));
  });

  it("verifies a three-event chain and detects a changed middle event", () => {
    const events: ChainEvent[] = [];
    let previous = "";
    for (const [index, payload] of ["one", "two", "three"].entries()) {
      const type = "TEST";
      const timestamp = `2026-11-0${index + 1}T00:00:00Z`;
      const hash = chainHash(previous, type, payload, timestamp);
      events.push({ type, payload, timestamp, prevHash: previous, hash });
      previous = hash;
    }
    expect(verifyHashChain(events)).toBe(true);
    const changed = events.map((event) => ({ ...event }));
    changed[1] = { ...changed[1], payload: "tampered" };
    expect(verifyHashChain(changed)).toBe(false);
  });
});
