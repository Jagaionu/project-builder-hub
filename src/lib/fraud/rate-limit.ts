// Pure rate-limit helpers (tested). The actual counting query lives in the
// .server file; these keep the window/threshold logic tunable and testable.
import type { FraudSettings } from "./fraud-config";

export function rateWindowStartMs(nowMs: number, cfg: FraudSettings): number {
  return nowMs - cfg.rateLimitWindowMinutes * 60 * 1000;
}

export function exceedsRateLimit(attemptsInWindow: number, cfg: FraudSettings): boolean {
  return attemptsInWindow >= cfg.rateLimitMaxAttempts;
}

// Strip anything outside a safe charset so identifiers cannot inject into a
// PostgREST .or() filter.
export function sanitizeIdent(v: string): string {
  return (v || "").replace(/[^A-Za-z0-9._:-]/g, "");
}
