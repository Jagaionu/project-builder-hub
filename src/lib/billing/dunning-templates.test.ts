import { describe, it, expect } from "vitest";
import { dunningTemplate } from "./dunning-templates";

const args = {
  companyName: "Acme Logistics",
  invoiceRef: "INV-ABCD1234",
  amountFormatted: "£604.00",
  billingUrl: "https://app.example.com/billing?token=xyz",
};

describe("dunningTemplate", () => {
  it("day1 includes the billing link and amount", () => {
    const e = dunningTemplate("day1", args);
    expect(e.subject).toContain("INV-ABCD1234");
    expect(e.text).toContain("£604.00");
    expect(e.text).toContain(args.billingUrl);
    expect(e.html).toContain(args.billingUrl);
  });

  it("escalates wording by step", () => {
    expect(dunningTemplate("day1", args).subject.toLowerCase()).toContain("action needed");
    expect(dunningTemplate("day3", args).subject.toLowerCase()).toContain("reminder");
    expect(dunningTemplate("suspended_warning", args).subject.toLowerCase()).toContain(
      "final notice",
    );
  });

  it("escapes HTML in dynamic fields", () => {
    const e = dunningTemplate("day1", { ...args, companyName: "A&B <Ltd>" });
    expect(e.html).toContain("A&amp;B &lt;Ltd&gt;");
    expect(e.html).not.toContain("<Ltd>");
  });
});
