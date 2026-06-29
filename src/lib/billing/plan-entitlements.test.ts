import { describe, it, expect } from "vitest";
import { entitlementsForPlan } from "./plan-entitlements";

describe("entitlementsForPlan", () => {
  it("starter excludes maps and ai_agent", () => {
    const e = entitlementsForPlan("starter");
    expect(e.modules).not.toContain("maps");
    expect(e.modules).not.toContain("ai_agent");
    expect(e.maxDrivers).toBe(20);
    expect(e.maxSeats).toBe(3);
    expect(e.customBranding).toBe(false);
  });

  it("pro adds maps but not ai_agent", () => {
    const e = entitlementsForPlan("pro");
    expect(e.modules).toContain("maps");
    expect(e.modules).not.toContain("ai_agent");
    expect(e.maxDrivers).toBe(50);
    expect(e.maxSeats).toBe(10);
  });

  it("enterprise unlocks everything and custom branding", () => {
    const e = entitlementsForPlan("enterprise");
    expect(e.modules).toContain("maps");
    expect(e.modules).toContain("ai_agent");
    expect(e.customBranding).toBe(true);
    expect(e.maxDrivers).toBe(500);
    expect(e.maxSeats).toBe(50);
  });

  it("returns a fresh copy that callers cannot mutate", () => {
    const a = entitlementsForPlan("pro");
    a.modules.push("ai_agent");
    const b = entitlementsForPlan("pro");
    expect(b.modules).not.toContain("ai_agent");
  });
});
