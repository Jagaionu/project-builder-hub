import { describe, it, expect } from "vitest";
import {
  UK_VAT_BP,
  applyTax,
  determineTaxMethod,
  grossUpFee,
  priceForPlan,
  formatMinor,
} from "./pricing";
import type { FeeConfig } from "./types";

const GOCARDLESS: FeeConfig = {
  provider: "gocardless",
  card_region: "any",
  percentage_bp: 100, // 1%
  fixed_fee_minor: 20, // £0.20
  cap_minor: 400, // £4.00 cap
};

const STRIPE_UK: FeeConfig = {
  provider: "stripe",
  card_region: "uk",
  percentage_bp: 150, // 1.5%
  fixed_fee_minor: 20,
  cap_minor: null,
};

const BANK_TRANSFER: FeeConfig = {
  provider: "bank_transfer",
  card_region: "any",
  percentage_bp: 0,
  fixed_fee_minor: 0,
  cap_minor: null,
};

describe("determineTaxMethod", () => {
  it("UK customer is standard-rated", () => {
    expect(determineTaxMethod({ countryCode: "GB" })).toBe("standard");
  });
  it("EU customer with validated VAT number is reverse-charged", () => {
    expect(determineTaxMethod({ countryCode: "DE", vatNumber: "DE123", vatValidated: true })).toBe(
      "reverse_charge",
    );
  });
  it("EU customer without a validated VAT number is standard-rated (conservative)", () => {
    expect(determineTaxMethod({ countryCode: "FR" })).toBe("standard");
    expect(determineTaxMethod({ countryCode: "FR", vatNumber: "FR1", vatValidated: false })).toBe(
      "standard",
    );
  });
  it("non-UK non-EU customer is zero-rated (export of services)", () => {
    expect(determineTaxMethod({ countryCode: "US" })).toBe("zero_rated");
  });
  it("is case-insensitive on country code", () => {
    expect(determineTaxMethod({ countryCode: "gb" })).toBe("standard");
  });
});

describe("applyTax", () => {
  it("applies 20% VAT for standard method", () => {
    expect(applyTax(60000, "standard", UK_VAT_BP)).toBe(12000);
  });
  it("returns 0 for reverse_charge / zero_rated / exempt", () => {
    expect(applyTax(60000, "reverse_charge", UK_VAT_BP)).toBe(0);
    expect(applyTax(60000, "zero_rated", UK_VAT_BP)).toBe(0);
    expect(applyTax(60000, "exempt", UK_VAT_BP)).toBe(0);
  });
  it("rounds to nearest penny", () => {
    // 1999 * 20% = 399.8 -> 400
    expect(applyTax(1999, "standard", UK_VAT_BP)).toBe(400);
  });
  it("rejects negative / non-integer net", () => {
    expect(() => applyTax(-1, "standard", UK_VAT_BP)).toThrow();
    expect(() => applyTax(1.5, "standard", UK_VAT_BP)).toThrow();
  });
});

describe("grossUpFee", () => {
  it("matches the £600 -> £604 GoCardless example (cap applied)", () => {
    // (60000 + 20) / 0.99 = 60626.26 -> ceil 60627 -> fee 627, capped at 400.
    expect(grossUpFee(60000, GOCARDLESS)).toBe(400);
  });
  it("does not cap when below the cap", () => {
    // small amount: (1000 + 20)/0.99 = 1030.3 -> 1031 -> fee 31 (< 400)
    expect(grossUpFee(1000, GOCARDLESS)).toBe(31);
  });
  it("computes Stripe UK fee with no cap", () => {
    // (60000 + 20)/0.985 = 60934.01 -> ceil 60935 -> fee 935
    expect(grossUpFee(60000, STRIPE_UK)).toBe(935);
  });
  it("returns 0 for a zero-fee provider", () => {
    expect(grossUpFee(60000, BANK_TRANSFER)).toBe(0);
  });
  it("rejects a fee percentage >= 100%", () => {
    expect(() => grossUpFee(1000, { ...STRIPE_UK, percentage_bp: 10000 })).toThrow();
  });
});

describe("priceForPlan", () => {
  it("UK customer: net + 20% VAT + Stripe fee", () => {
    const b = priceForPlan({ netMinor: 60000, countryCode: "GB", fee: STRIPE_UK });
    expect(b.netMinor).toBe(60000);
    expect(b.taxMinor).toBe(12000); // 20% of 600
    // fee grossed up over 72000: (72000+20)/0.985 = 73116.75 -> ceil 73117 -> fee 1117
    expect(b.feeMinor).toBe(1117);
    expect(b.grossMinor).toBe(60000 + 12000 + 1117);
    expect(b.taxMethod).toBe("standard");
    expect(b.taxRateBp).toBe(UK_VAT_BP);
  });

  it("reverse-charge customer pays exactly £604 via GoCardless on £600 (no VAT)", () => {
    const b = priceForPlan({
      netMinor: 60000,
      countryCode: "DE",
      vatNumber: "DE123456789",
      vatValidated: true,
      fee: GOCARDLESS,
    });
    expect(b.taxMethod).toBe("reverse_charge");
    expect(b.taxMinor).toBe(0);
    expect(b.feeMinor).toBe(400); // capped
    expect(b.grossMinor).toBe(60400); // £604.00
    expect(b.taxRateBp).toBe(0);
  });

  it("bank transfer has no fee and no markup", () => {
    const b = priceForPlan({
      netMinor: 60000,
      countryCode: "GB",
      fee: BANK_TRANSFER,
    });
    expect(b.feeMinor).toBe(0);
    expect(b.grossMinor).toBe(72000); // net + VAT only
  });

  it("zero-rated export customer pays net + fee, no VAT", () => {
    const b = priceForPlan({ netMinor: 60000, countryCode: "US", fee: GOCARDLESS });
    expect(b.taxMethod).toBe("zero_rated");
    expect(b.taxMinor).toBe(0);
    expect(b.grossMinor).toBe(60400);
  });

  it("honours an exempt override", () => {
    const b = priceForPlan({
      netMinor: 60000,
      countryCode: "GB",
      fee: BANK_TRANSFER,
      taxMethodOverride: "exempt",
    });
    expect(b.taxMinor).toBe(0);
    expect(b.grossMinor).toBe(60000);
  });

  it("gross always equals net + tax + fee", () => {
    for (const net of [0, 100, 12345, 60000, 150000]) {
      for (const fee of [GOCARDLESS, STRIPE_UK, BANK_TRANSFER]) {
        const b = priceForPlan({ netMinor: net, countryCode: "GB", fee });
        expect(b.grossMinor).toBe(b.netMinor + b.taxMinor + b.feeMinor);
      }
    }
  });
});

describe("formatMinor", () => {
  it("formats GBP pence", () => {
    expect(formatMinor(60400)).toBe("£604.00");
    expect(formatMinor(0)).toBe("£0.00");
    expect(formatMinor(-500)).toBe("-£5.00");
  });
});
