// Server-side trial-config loader/saver. Merges the DB row over code defaults;
// tolerant if the table does not exist yet.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TRIAL_CONFIG, TRIAL_CONFIG_COLUMNS, type TrialConfig } from "./trial-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export async function loadTrialConfig(): Promise<TrialConfig> {
  const out = { ...DEFAULT_TRIAL_CONFIG };
  try {
    const { data } = await sb.from("trial_config").select("*").eq("id", 1).maybeSingle();
    if (!data) return out;
    if (typeof data.currency === "string") out.currency = data.currency;
    if (typeof data.trial_7_fee_minor === "number") out.trial7FeeMinor = data.trial_7_fee_minor;
    if (typeof data.trial_14_fee_minor === "number") out.trial14FeeMinor = data.trial_14_fee_minor;
    if (typeof data.default_trial_days === "number") out.defaultTrialDays = data.default_trial_days;
    return out;
  } catch {
    return out;
  }
}

export async function saveTrialConfig(patch: Partial<TrialConfig>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { id: 1 };
  const keys = Object.keys(patch) as Array<keyof TrialConfig>;
  for (const k of keys) {
    const v = patch[k];
    if (v !== undefined) row[TRIAL_CONFIG_COLUMNS[k]] = v;
  }
  await sb.from("trial_config").upsert(row as never, { onConflict: "id" });
}
