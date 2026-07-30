// Post-signup behavioural risk sweep. Focuses on high-priority, near-impossible
// patterns on ACTIVE TRIALS (not established/trusted companies). Flags a trial
// to pending_review, writes trial_risk_events, and notifies super-admins.
// Thresholds are configurable (fraud_settings behaviour_*).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail } from "@/lib/billing/email.server";
import { loadFraudSettings } from "./fraud-config.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };
const DAY = 24 * 60 * 60 * 1000;

async function notifySuperAdmins(subject: string, text: string): Promise<void> {
  try {
    const { data } = await sb.from("super_admins").select("user_id");
    const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).slice(0, 5);
    for (const id of ids) {
      try {
        const u = await supabaseAdmin.auth.admin.getUserById(id);
        const to = u.data?.user?.email;
        if (to) await sendEmail({ to, subject, text, html: "<p>" + text + "</p>" });
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

export interface BehaviourSweepResult {
  flagged: number;
}

export async function runBehaviouralRiskSweep(): Promise<BehaviourSweepResult> {
  const cfg = await loadFraudSettings();
  const since = new Date(Date.now() - DAY).toISOString();
  let flagged = 0;
  try {
    const { data: cos } = await sb
      .from("companies")
      .select("id, name, verification_status")
      .eq("subscription_status", "trial");
    for (const c of (cos ?? []) as Array<Record<string, unknown>>) {
      const vs = c.verification_status as string | null;
      if (vs === "trusted" || vs === "blocked" || vs === "pending_review") continue;
      const id = c.id as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signals: Array<{ signal: string; points: number; detail: any }> = [];

      try {
        const { count } = await sb
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", id)
          .gte("created_at", since);
        if ((count ?? 0) > cfg.behaviourMaxJobs24h) signals.push({ signal: "job_spike", points: 40, detail: { count } });
      } catch {
        // skip
      }
      try {
        const { count } = await sb
          .from("drivers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", id)
          .gte("created_at", since);
        if ((count ?? 0) > cfg.behaviourMaxDrivers24h) signals.push({ signal: "driver_spike", points: 40, detail: { count } });
      } catch {
        // skip
      }
      try {
        const { data: evs } = await sb
          .from("user_login_events")
          .select("device_id, country")
          .eq("company_id", id)
          .gte("created_at", since)
          .limit(500);
        const devices = new Set<string>();
        const countries = new Set<string>();
        for (const e of (evs ?? []) as Array<{ device_id?: string | null; country?: string | null }>) {
          if (e.device_id) devices.add(e.device_id);
          if (e.country) countries.add(e.country);
        }
        if (devices.size > cfg.behaviourMaxDevices24h) signals.push({ signal: "multi_device", points: 40, detail: { devices: devices.size } });
        if (countries.size > cfg.behaviourMaxCountries24h) signals.push({ signal: "multi_country", points: 50, detail: { countries: countries.size } });
      } catch {
        // skip
      }

      if (signals.length === 0) continue;
      for (const s of signals) {
        try {
          await sb
            .from("trial_risk_events")
            .insert({ tenant_id: id, signal: s.signal, severity: "high", points: s.points, detail: s.detail } as never);
        } catch {
          // skip
        }
      }
      try {
        await sb.from("companies").update({ verification_status: "pending_review" }).eq("id", id);
      } catch {
        // skip
      }
      await notifySuperAdmins(
        "Trial flagged by behaviour monitoring",
        "Company " + ((c.name as string) ?? id) + " was flagged: " + signals.map((x) => x.signal).join(", "),
      );
      flagged += 1;
    }
  } catch {
    // tolerant
  }
  return { flagged };
}
