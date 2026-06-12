import { describe, it, expect, vi } from "vitest";
import {
  OperationInProgressError,
  withIdempotency,
  type IdempotencyStore,
  type IdempotencyRow,
} from "./idempotency";

/** In-memory store mirroring the UNIQUE(key, operation) semantics of Postgres. */
function makeStore(): IdempotencyStore & { rows: Map<string, IdempotencyRow> } {
  const rows = new Map<string, IdempotencyRow>();
  const k = (key: string, op: string) => `${op}::${key}`;
  return {
    rows,
    async reserve(key, operation) {
      const id = k(key, operation);
      if (rows.has(id)) return { existing: true, row: rows.get(id)! };
      rows.set(id, { result: null });
      return { existing: false };
    },
    async complete(key, operation, result) {
      rows.set(k(key, operation), { result });
    },
    async release(key, operation) {
      rows.delete(k(key, operation));
    },
  };
}

describe("withIdempotency", () => {
  it("runs the operation once and returns its result", async () => {
    const store = makeStore();
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const out = await withIdempotency(store, { key: "k1", operation: "charge" }, fn);
    expect(out).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns the stored result on a repeat call without re-running", async () => {
    const store = makeStore();
    const fn = vi.fn().mockResolvedValue({ chargeId: "abc" });
    await withIdempotency(store, { key: "k1", operation: "charge" }, fn);
    const second = await withIdempotency(store, { key: "k1", operation: "charge" }, fn);
    expect(second).toEqual({ chargeId: "abc" });
    expect(fn).toHaveBeenCalledTimes(1); // not called again
  });

  it("treats different operations with the same key independently", async () => {
    const store = makeStore();
    const a = vi.fn().mockResolvedValue("A");
    const b = vi.fn().mockResolvedValue("B");
    expect(await withIdempotency(store, { key: "k", operation: "charge" }, a)).toBe("A");
    expect(await withIdempotency(store, { key: "k", operation: "refund" }, b)).toBe("B");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("throws OperationInProgressError when a reservation exists with no result", async () => {
    const store = makeStore();
    await store.reserve("k1", "charge", null); // simulate in-flight
    await expect(
      withIdempotency(store, { key: "k1", operation: "charge" }, async () => "x"),
    ).rejects.toBeInstanceOf(OperationInProgressError);
  });

  it("releases the reservation on failure so a retry can run", async () => {
    const store = makeStore();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce("recovered");
    await expect(withIdempotency(store, { key: "k1", operation: "charge" }, fn)).rejects.toThrow(
      "network blip",
    );
    // reservation released -> retry succeeds
    const out = await withIdempotency(store, { key: "k1", operation: "charge" }, fn);
    expect(out).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("requires a key", async () => {
    const store = makeStore();
    await expect(
      withIdempotency(store, { key: "", operation: "charge" }, async () => 1),
    ).rejects.toThrow("idempotency key is required");
  });
});
