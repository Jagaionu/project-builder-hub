// Server helper: assemble a fee-inclusive PriceBreakdown from the DB price
// book, provider fee schedule, and the company's tax profile.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { priceForPlan } from "./pricing";
import type {
  BillingInterval,
  CardRegion,
  FeeConfig,
  PlanTier,
  PriceBreakdown,
  Provider,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function loadNetMinor(plan: PlanTier, interval: BillingInterval): Promise<number> {
  const { data } = await sb
    .from("plan_prices")
    .select("net_amount_minor")
    .eq("plan", plan)
    .eq("interval", interval)
    .eq("currency", "GBP")
    .eq("active", true)
    .maybeSingle();
  if (!data) throw new Error(`No active GBP price for ${plan}/${interval}`);
  return data.net_amount_minor as number;
}

async function loadFeeConfig(provider: Provider, region: CardRegion): Promise<FeeConfig> {
  // Prefer an exact region match, then fall back to 'any'.
  const { data: rows } = await sb
    .from("provider_fee_config")
    .select("provider, card_region, percentage_bp, fixed_fee_minor, cap_minor")
    .eq("provider", provider)
    .eq("active", true);
  const list = (rows ?? []) as FeeConfig[];
  const exact = list.find((r) => r.card_region === region);
  const anyRegion = list.find((r) => r.card_region === "any");
  const cfg = exact ?? anyRegion ?? list[0];
  if (!cfg) throw new Error(`No fee config for provider ${provider}`);
  return cfg;
}

export async function buildBreakdown(args: {
  companyId: string;
  plan: PlanTier;
  interval: BillingInterval;
  provider: Provider;
  cardRegion?: CardRegion;
  /** Override the net amount (e.g. a prorated adjustment). */
  netMinorOverride?: number;
}): Promise<PriceBreakdown> {
  const { companyId, plan, interval, provider, cardRegion = "uk", netMinorOverride } = args;

  const { data: company } = await sb
    .from("companies")
    .select("country_code, vat_number, vat_validated_at")
    .eq("id", companyId)
    .maybeSingle();

  const netMinor = netMinorOverride ?? (await loadNetMinor(plan, interval));
  const fee = await loadFeeConfig(provider, cardRegion);

  return priceForPlan({
    netMinor,
    countryCode: company?.country_code ?? "GB",
    vatNumber: company?.vat_number ?? null,
    vatValidated: Boolean(company?.vat_validated_at),
    fee,
    currency: "GBP",
  });
}
