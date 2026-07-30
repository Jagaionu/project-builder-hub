import { describe, it, expect } from "vitest";
import { DEFAULT_FRAUD_SETTINGS } from "./fraud-config";
import { rateWindowStartMs, exceedsRateLimit, sanitizeIdent } from "./rate-limit";

const cfg = DEFAULT_FRAUD_SETTINGS;

describe("rate limit", () => {
  it("window start is now minus window minutes", () => {
    const now = 10_000_000;
    expect(rateWindowStartMs(now, cfg)).toBe(now - 10 * 60 * 1000);
  });
  it("does not limit below the max", () => {
    expect(exceedsRateLimit(9, cfg)).toBe(false);
  });
  it("limits at or above the max", () => {
    expect(exceedsRateLimit(10, cfg)).toBe(true);
    expect(exceedsRateLimit(11, cfg)).toBe(true);
  });
  it("respects a config override", () => {
    expect(exceedsRateLimit(3, { ...cfg, rateLimitMaxAttempts: 3 })).toBe(true);
  });
  it("sanitizes identifiers for the or filter", () => {
    expect(sanitizeIdent("1.2.3.4,ip.eq.x")).toBe("1.2.3.4ip.eq.x");
    expect(sanitizeIdent("dev-abc_123:9")).toBe("dev-abc_123:9");
  });
});
