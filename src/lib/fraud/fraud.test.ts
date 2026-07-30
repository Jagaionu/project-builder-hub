import { describe, it, expect } from "vitest";
import { DEFAULT_FRAUD_SETTINGS } from "./fraud-config";
import { normalizeEmail, emailDomain, classifyEmailDomain } from "./email";
import {
  computeIdentityTrust,
  computeFraudRisk,
  decideSignup,
  cooldownActive,
} from "./scoring";

const cfg = DEFAULT_FRAUD_SETTINGS;

describe("normalizeEmail", () => {
  it("strips plus tags and collapses gmail dots", () => {
    expect(normalizeEmail("John.Smith+trial@gmail.com")).toBe("johnsmith@gmail.com");
    expect(normalizeEmail("a.b.c@googlemail.com")).toBe("abc@gmail.com");
  });
  it("keeps non-gmail dots but strips plus tags", () => {
    expect(normalizeEmail("planner+x@abc-haulage.co.uk")).toBe("planner@abc-haulage.co.uk");
  });
});

describe("classifyEmailDomain", () => {
  const free = new Set(["gmail.com"]);
  const disposable = new Set(["mailinator.com"]);
  it("classifies free, disposable and business", () => {
    expect(classifyEmailDomain(emailDomain("a@gmail.com"), free, disposable)).toBe("free");
    expect(classifyEmailDomain(emailDomain("a@mailinator.com"), free, disposable)).toBe("disposable");
    expect(classifyEmailDomain(emailDomain("a@abc-haulage.co.uk"), free, disposable)).toBe("business");
  });
});

describe("computeIdentityTrust", () => {
  it("gives max trust for CH + business email + director", () => {
    expect(
      computeIdentityTrust(
        { verificationMethod: "companies_house", businessEmail: true, directorProvided: true },
        cfg,
      ),
    ).toBe(130);
  });
  it("gives less for manual verification", () => {
    expect(
      computeIdentityTrust(
        { verificationMethod: "manual", businessEmail: false, directorProvided: false },
        cfg,
      ),
    ).toBe(40);
  });
});

describe("computeFraudRisk", () => {
  it("adds device + ip", () => {
    expect(
      computeFraudRisk(
        { deviceSeenBefore: true, ipSeenBefore: true, emailKind: "business", recentFailedSignups: false },
        cfg,
      ),
    ).toBe(50);
  });
  it("disposable dominates free", () => {
    expect(
      computeFraudRisk(
        { deviceSeenBefore: false, ipSeenBefore: false, emailKind: "disposable", recentFailedSignups: false },
        cfg,
      ),
    ).toBe(40);
  });
});

describe("decideSignup", () => {
  it("blocks a duplicate company number in cooldown before scoring", () => {
    const r = decideSignup(
      { identityTrust: 130, fraudRisk: 0, chVerified: true, duplicateWithinCooldown: true, alreadyTrusted: false },
      cfg,
    );
    expect(r.decision).toBe("blocked");
  });
  it("auto-activates a CH-verified, high-trust, low-risk signup", () => {
    const r = decideSignup(
      { identityTrust: 120, fraudRisk: 20, chVerified: true, duplicateWithinCooldown: false, alreadyTrusted: false },
      cfg,
    );
    expect(r.decision).toBe("active");
  });
  it("sends manual verification to review", () => {
    const r = decideSignup(
      { identityTrust: 60, fraudRisk: 0, chVerified: false, duplicateWithinCooldown: false, alreadyTrusted: false },
      cfg,
    );
    expect(r.decision).toBe("pending_review");
    expect(r.reasons).toContain("manual_verification");
  });
  it("sends a high-risk CH signup to review", () => {
    const r = decideSignup(
      { identityTrust: 130, fraudRisk: 50, chVerified: true, duplicateWithinCooldown: false, alreadyTrusted: false },
      cfg,
    );
    expect(r.decision).toBe("pending_review");
    expect(r.reasons).toContain("risk_threshold_exceeded");
  });
  it("trusted companies skip checks", () => {
    const r = decideSignup(
      { identityTrust: 0, fraudRisk: 999, chVerified: false, duplicateWithinCooldown: false, alreadyTrusted: true },
      cfg,
    );
    expect(r.decision).toBe("active");
  });
  it("respects a config change to the threshold", () => {
    const strict = { ...cfg, riskThreshold: 20 };
    const r = decideSignup(
      { identityTrust: 130, fraudRisk: 30, chVerified: true, duplicateWithinCooldown: false, alreadyTrusted: false },
      strict,
    );
    expect(r.decision).toBe("pending_review");
  });
});

describe("cooldownActive", () => {
  const now = Date.parse("2026-07-30T00:00:00Z");
  it("is active within the window", () => {
    const twelveMonthsAgo = now - 12 * 30 * 24 * 60 * 60 * 1000;
    expect(cooldownActive(twelveMonthsAgo, now, 24)).toBe(true);
  });
  it("is inactive after the window", () => {
    const thirtyMonthsAgo = now - 30 * 31 * 24 * 60 * 60 * 1000;
    expect(cooldownActive(thirtyMonthsAgo, now, 24)).toBe(false);
  });
  it("is inactive with no prior trial", () => {
    expect(cooldownActive(null, now, 24)).toBe(false);
  });
});
