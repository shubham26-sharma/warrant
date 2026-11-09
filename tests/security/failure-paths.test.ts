import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { appendEvent, getAuditAppendTimeoutMs } from "../../src/lib/audit/chain";
import { PayPalUnavailableError } from "../../src/lib/errors";
import { MandateSchema } from "../../src/lib/schemas/mandate";
import { MemoryStore } from "../../src/lib/store/memory";
import { PrismaStore } from "../../src/lib/store/prisma";
import { withStoreTimeout } from "../../src/lib/store/timeout";
import type { AuditEventRecord, Store } from "../../src/lib/store/types";
import { getDbConnectTimeoutMs, getDbQueryTimeoutMs, getDbStoreTimeoutMs, TimeoutError, withTimeout } from "../../src/lib/timeout";

const runtimeState = vi.hoisted(() => ({ store: undefined as unknown as Store }));
const mockCompleteCheckout = vi.hoisted(() => vi.fn());
const mockStartCheckout = vi.hoisted(() => vi.fn());
const mockApproveReview = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({
  getStore: () => runtimeState.store,
  getAppBaseUrl: () => "https://warrant.onrender.com",
}));

vi.mock("@/lib/gateway/purchase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gateway/purchase")>();
  return {
    ...actual,
    completeCheckout: mockCompleteCheckout,
    startCheckout: mockStartCheckout,
    approveReview: mockApproveReview,
  };
});

import { GET as auditGet } from "../../src/app/api/audit/route";
import { POST as auditVerifyPost } from "../../src/app/api/audit/verify/route";
import { GET as mandatesGet, POST as mandatesPost } from "../../src/app/api/mandates/route";
import { POST as completePost } from "../../src/app/api/paypal/complete/route";
import { GET as purchaseGet } from "../../src/app/api/purchases/[decisionId]/route";
import { POST as approveReviewPost } from "../../src/app/api/purchases/[decisionId]/approve-review/route";
import { POST as checkoutPost } from "../../src/app/api/purchases/[decisionId]/checkout/route";

function failingStore(error: Error): Store {
  return new Proxy(new MemoryStore(), {
    get() {
      return async () => {
        throw error;
      };
    },
  });
}

describe("timeout helpers and fast generic failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.store = new MemoryStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects hung store calls on timeout and recovers the audit append queue", async () => {
    vi.useFakeTimers();
    const memory = new MemoryStore();
    const wrapped = withStoreTimeout(memory, 200);
    const hungStore = withStoreTimeout(new Proxy(memory, {
      get(target, property) {
        if (property === "listAuditEvents") {
          return () => new Promise(() => {});
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }), 200);

    const firstAppend = appendEvent(hungStore, "TEST_HANG", { step: 1 });
    const firstAssertion = expect(firstAppend).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(200);
    await firstAssertion;
    expect(vi.getTimerCount()).toBe(0);

    const recovered = await appendEvent(wrapped, "TEST_RECOVER", { step: 2 });
    expect(recovered.type).toBe("TEST_RECOVER");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears withTimeout timers and absorbs late rejections from timed-out work", async () => {
    vi.useFakeTimers();
    const slowReject = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("late db failure")), 500);
    });

    const raced = withTimeout(slowReject, 100, "Database request timed out");
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns generic 503 messages without leaking database internals across DB routes", async () => {
    const rawSecretError = new Error("connect ECONNREFUSED postgresql://user:secret@ep-demo.neon.tech/neondb");
    runtimeState.store = failingStore(rawSecretError);
    mockApproveReview.mockRejectedValue(rawSecretError);
    mockStartCheckout.mockRejectedValue(rawSecretError);
    mockCompleteCheckout.mockRejectedValue(rawSecretError);

    const checks: Array<{ response: Response; expectedStatus: number; expectedError: string }> = [
      { response: await mandatesGet(), expectedStatus: 503, expectedError: "Could not load mandates" },
      {
        response: await mandatesPost(new Request("http://localhost/api/mandates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previousMandateId: "550e8400-e29b-41d4-a716-446655440000" }),
        })),
        expectedStatus: 503,
        expectedError: "Could not confirm mandate",
      },
      { response: await auditGet(), expectedStatus: 503, expectedError: "Could not load audit events" },
      { response: await auditVerifyPost(), expectedStatus: 503, expectedError: "Could not verify audit chain" },
      {
        response: await purchaseGet(new Request("http://localhost/api/purchases/d1"), { params: Promise.resolve({ decisionId: "d1" }) }),
        expectedStatus: 503,
        expectedError: "Could not load purchase",
      },
      {
        response: await approveReviewPost(
          new Request("http://localhost/api/purchases/d1/approve-review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: "Reviewed invoice" }),
          }),
          { params: Promise.resolve({ decisionId: "d1" }) },
        ),
        expectedStatus: 503,
        expectedError: "Approval failed",
      },
      {
        response: await checkoutPost(
          new Request("http://localhost/api/purchases/d1/checkout", { method: "POST" }),
          { params: Promise.resolve({ decisionId: "d1" }) },
        ),
        expectedStatus: 503,
        expectedError: "Checkout could not start. Please try again.",
      },
      {
        response: await completePost(new Request("http://localhost/api/paypal/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "PP-ORDER-1" }),
        })),
        expectedStatus: 503,
        expectedError: "Could not complete PayPal checkout. Please try again.",
      },
    ];

    for (const check of checks) {
      expect(check.response.status).toBe(check.expectedStatus);
      const raw = await check.response.text();
      expect(JSON.parse(raw)).toEqual({ error: check.expectedError });
      expect(raw).not.toContain("ECONNREFUSED");
      expect(raw).not.toContain("neondb");
      expect(raw).not.toContain("secret");
    }
  });

  it("returns generic 502 responses when PayPal Sandbox fails or times out", async () => {
    const payPalError = new PayPalUnavailableError("PayPal upstream 500 internal trace secret-id");
    mockStartCheckout.mockRejectedValue(payPalError);
    mockCompleteCheckout.mockRejectedValue(payPalError);

    const checkoutRes = await checkoutPost(
      new Request("http://localhost/api/purchases/d1/checkout", { method: "POST" }),
      { params: Promise.resolve({ decisionId: "d1" }) },
    );
    expect(checkoutRes.status).toBe(502);
    expect(await checkoutRes.json()).toEqual({ error: "PayPal Sandbox is temporarily unavailable. Please try again." });

    const completeRes = await completePost(new Request("http://localhost/api/paypal/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "PP-ORDER-1" }),
    }));
    expect(completeRes.status).toBe(502);
    expect(await completeRes.json()).toEqual({ error: "PayPal Sandbox is temporarily unavailable. Please try again." });
  });

  it("keeps default withStoreTimeout and audit append timeout at least as long as configured DB timeouts", async () => {
    vi.useFakeTimers();
    expect(getDbConnectTimeoutMs()).toBe(15_000);
    expect(getDbQueryTimeoutMs()).toBe(15_000);
    expect(getDbStoreTimeoutMs()).toBe(30_000);
    expect(getAuditAppendTimeoutMs()).toBe(30_000);

    vi.stubEnv("DB_CONNECT_TIMEOUT_MS", "20000");
    vi.stubEnv("DB_QUERY_TIMEOUT_MS", "25000");
    expect(getDbStoreTimeoutMs()).toBe(45_000);
    expect(getAuditAppendTimeoutMs()).toBe(45_000);

    const hungStore = withStoreTimeout(new Proxy(new MemoryStore(), {
      get(target, property) {
        if (property === "listMandates") return () => new Promise(() => {});
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }));

    const pendingRead = hungStore.listMandates();
    const timedOutRead = expect(pendingRead).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await timedOutRead;
    expect(vi.getTimerCount()).toBe(0);

    let appendAttempts = 0;
    const savedEvent: AuditEventRecord = {
      id: 1,
      type: "TEST_RETRY",
      payload: { ok: true },
      prevHash: "",
      hash: "event-hash",
      createdAt: new Date(0).toISOString(),
    };
    const retryingAuditStore = new Proxy(new MemoryStore(), {
      get(target, property) {
        if (property === "listAuditEvents") return async () => [];
        if (property === "appendAuditEvent") {
          return async () => {
            appendAttempts += 1;
            if (appendAttempts === 1) {
              await new Promise((resolve) => setTimeout(resolve, 10_000));
              throw new Error("Audit chain changed during append; retry with the latest tail");
            }
            return savedEvent;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const appendPromise = appendEvent(retryingAuditStore, "TEST_RETRY", { ok: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await appendPromise).toEqual(savedEvent);
    expect(appendAttempts).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries PrismaStore read paths once on connection errors and never retries writes or transaction-scoped reads", async () => {
    const parsedMandate = MandateSchema.parse(fixture.baseMandate);
    const mandateRow = {
      id: parsedMandate.mandateId,
      familyId: parsedMandate.mandateId,
      version: parsedMandate.version,
      text: parsedMandate.originalText,
      constraints: {
        currency: parsedMandate.currency,
        hardConstraints: parsedMandate.hardConstraints,
        softConstraints: parsedMandate.softConstraints,
        ambiguity: parsedMandate.ambiguity,
      },
      hash: "hash-1",
      status: parsedMandate.status,
      confirmedAt: parsedMandate.confirmedAt ? new Date(parsedMandate.confirmedAt) : null,
    };

    const transientConnectionError = Object.assign(new Error("Connection terminated due to connection timeout"), {
      cause: new Error("Connection terminated unexpectedly"),
    });

    const findUnique = vi.fn()
      .mockRejectedValueOnce(transientConnectionError)
      .mockResolvedValueOnce(mandateRow);
    const findMany = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Server has closed the connection"), { code: "P1017" }))
      .mockRejectedValueOnce(new TimeoutError("Database request timed out"));
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }));

    const fakePrisma = {
      mandate: { findUnique, findMany, create },
      auditEvent: { findMany: vi.fn().mockRejectedValue(transientConnectionError) },
    };

    const store = new PrismaStore(fakePrisma as never);
    const loaded = await store.getMandate(parsedMandate.mandateId);
    expect(loaded?.mandateId).toBe(parsedMandate.mandateId);
    expect(findUnique).toHaveBeenCalledTimes(2);

    await expect(store.listMandates()).rejects.toBeInstanceOf(TimeoutError);
    expect(findMany).toHaveBeenCalledTimes(2);

    // A non-idempotent write must never retry on a connection error.
    await expect(store.createMandate({ ...parsedMandate, familyId: parsedMandate.mandateId, hash: "hash-1" }))
      .rejects.toThrow(/ECONNRESET/);
    expect(create).toHaveBeenCalledTimes(1);

    const txRunner = vi.fn().mockRejectedValue(transientConnectionError);
    const writeStore = new PrismaStore({ $transaction: txRunner } as never);
    await expect(writeStore.appendAuditEvent({
      type: "TEST_WRITE",
      payload: { ok: true },
      prevHash: "",
      hash: "h1",
      createdAt: new Date(0).toISOString(),
    })).rejects.toThrow(/connection timeout/);
    expect(txRunner).toHaveBeenCalledTimes(1);

    // Non-connection errors (e.g. slow query read timeouts or unique constraint errors) must not retry.
    const queryTimeoutFind = vi.fn().mockRejectedValue(new Error("Query read timeout"));
    const adapterReadFind = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Driver error"), { cause: { kind: "DatabaseNotReachable" } }))
      .mockResolvedValueOnce([mandateRow]);
    const selectiveStore = new PrismaStore({
      mandate: { findUnique: queryTimeoutFind, findMany: adapterReadFind },
    } as never);
    await expect(selectiveStore.getMandate(parsedMandate.mandateId)).rejects.toThrow(/Query read timeout/);
    expect(queryTimeoutFind).toHaveBeenCalledTimes(1);
    expect(await selectiveStore.listMandates()).toHaveLength(1);
    expect(adapterReadFind).toHaveBeenCalledTimes(2);

    // Transaction-scoped reads must not retry after a statement failure inside a transaction.
    const txFindUnique = vi.fn().mockRejectedValue(transientConnectionError);
    const txStore = new PrismaStore({ mandate: { findUnique: txFindUnique } } as never, true);
    await expect(txStore.getMandate(parsedMandate.mandateId)).rejects.toThrow(/connection timeout/);
    expect(txFindUnique).toHaveBeenCalledTimes(1);
  });
});

