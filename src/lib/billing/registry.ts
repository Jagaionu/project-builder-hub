// Provider registry: resolves a PaymentProvider implementation by id.
import type { PaymentProvider } from "./provider";
import type { Provider } from "./types";
import { stripeProvider } from "./providers/stripe";
import { gocardlessProvider } from "./providers/gocardless";
import { bankTransferProvider } from "./providers/bank-transfer";

const REGISTRY: Record<Provider, PaymentProvider> = {
  stripe: stripeProvider,
  gocardless: gocardlessProvider,
  bank_transfer: bankTransferProvider,
};

export function getProvider(id: Provider): PaymentProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`Unknown payment provider: ${id}`);
  return p;
}
