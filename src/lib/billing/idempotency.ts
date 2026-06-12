// Idempotency for billing operations. Reserve-FIRST so two concurrent calls
// with the same key can never both execute the side effect (e.g. a double
// charge or duplicate mandate). The store is abstracted so the core logic is
// unit-testable without a database.

export interface IdempotencyRow {
  result: unknown | null;
}

export interface IdempotencyStore {
  /**
   * Atomically reserve (key, operation). Implemented via a UNIQUE constraint.
   * - If newly inserted: returns { existing: false }.
   * - If it already exists: returns { existing: true, row } with the stored row
   *   (row.result is null while the original operation is still in flight).
   */
  reserve(
    key: string,
    operation: string,
    companyId: string | null,
  ): Promise<{ existing: boolean; row?: IdempotencyRow }>;
  /** Persist the result of a completed operation. */
  complete(key: string, operation: string, result: unknown): Promise<void>;
  /** Remove a reservation so a failed operation can be retried. */
  release(key: string, operation: string): Promise<void>;
}

/** Thrown when a duplicate request arrives while the original is still running. */
export class OperationInProgressError extends Error {
  constructor(public operation: string) {
    super(`Operation '${operation}' is already in progress for this idempotency key`);
    this.name = "OperationInProgressError";
  }
}

export interface WithIdempotencyArgs {
  key: string;
  operation: string;
  companyId?: string | null;
}

/**
 * Run `fn` at most once per (key, operation).
 *  - First caller: reserves, runs fn, stores and returns the result.
 *  - Later caller after completion: returns the stored result (no re-run).
 *  - Later caller while in flight: throws OperationInProgressError (treat as 409).
 *  - On failure: reservation is released so the caller can safely retry.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore,
  { key, operation, companyId = null }: WithIdempotencyArgs,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) throw new Error("idempotency key is required");

  const reservation = await store.reserve(key, operation, companyId);
  if (reservation.existing) {
    const row = reservation.row;
    if (row && row.result !== null && row.result !== undefined) {
      return row.result as T;
    }
    throw new OperationInProgressError(operation);
  }

  try {
    const result = await fn();
    await store.complete(key, operation, result ?? null);
    return result;
  } catch (err) {
    // Release so the operation is retryable; never persist a partial result.
    await store.release(key, operation);
    throw err;
  }
}
