// Server-side config + domain-signal loaders. Merge the DB fraud_settings row
// over the code defaults; tolerant if the table does not exist yet.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_FRAUD_SETTINGS, FRAUD_SETTING_COLUMNS, type FraudSettings } from "./fraud-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(row: any): FraudSettings {
  const out = { ...DEFAULT_FRAUD_SETTINGS };
  if (!row) return out;
  const keys = Object.keys(FRAUD_SETTING_COLUMNS) as Array<keyof FraudSettings>;
  for (const k of keys) {
    const col = FRAUD_SETTING_COLUMNS[k];
    const v = row[col];
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

export async function loadFraudSettings(): Promise<FraudSettings> {
  try {
    const { data } = await sb.from("fraud_settings").select("*").eq("id", 1).maybeSingle();
    return fromRow(data);
  } catch {
    return { ...DEFAULT_FRAUD_SETTINGS };
  }
}

export async function saveFraudSettings(patch: Partial<FraudSettings>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { id: 1 };
  const keys = Object.keys(patch) as Array<keyof FraudSettings>;
  for (const k of keys) {
    const v = patch[k];
    if (typeof v === "number") row[FRAUD_SETTING_COLUMNS[k]] = v;
  }
  await sb.from("fraud_settings").upsert(row as never, { onConflict: "id" });
}

export async function loadEmailDomainSets(): Promise<{ free: Set<string>; disposable: Set<string> }> {
  try {
    const { data } = await sb.from("email_domain_signals").select("domain, kind");
    const free = new Set<string>();
    const disposable = new Set<string>();
    for (const r of (data ?? []) as Array<{ domain: string; kind: string }>) {
      if (r.kind === "disposable") disposable.add(r.domain);
      else free.add(r.domain);
    }
    return { free, disposable };
  } catch {
    return { free: new Set<string>(), disposable: new Set<string>() };
  }
}
