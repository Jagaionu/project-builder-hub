// Bank transfer (offline) provider. No external API: invoices are issued with
// a unique payment reference and reconciled manually by a super admin (see the
// reconciliation server function + billing_reconciliation_log audit trail).
import type {
  BillingCustomer,
  ChargeResult,
  CheckoutResult,
  NormalisedEvent,
  PaymentProvider,
  ProviderStatus,
} from "../provider";

export const bankTransferProvider: PaymentProvider = {
  id: "bank_transfer",

  async createCustomer(customer: BillingCustomer): Promise<string> {
    // No external customer; the company id is the reference.
    return customer.providerRef ?? customer.companyId;
  },

  async createCheckout({ customer, successUrl }): Promise<CheckoutResult> {
    // Direct the customer to the in-app bank-details / instructions page.
    return { redirectUrl: successUrl, providerRef: `bank:${customer.companyId}` };
  },

  async chargeForPlan(): Promise<ChargeResult> {
    // No charge is taken automatically; the invoice stays "open" until an admin
    // reconciles an incoming bank transfer against it.
    return { invoiceProviderRef: "", status: "pending" };
  },

  async changePlan(): Promise<ChargeResult> {
    return { invoiceProviderRef: "", status: "pending" };
  },

  async parseWebhook(): Promise<NormalisedEvent> {
    throw new Error("Bank transfer has no webhooks");
  },

  async getStatus(): Promise<ProviderStatus> {
    // Status is derived from invoice/reconciliation state, not an external API.
    return { active: false, currentPeriodEnd: null };
  },
};
