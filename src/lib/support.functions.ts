import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Best-effort admin email when a support ticket is created. Gated on env:
//   SUPPORT_ALERT_EMAIL  - destination (the admin inbox)
//   RESEND_API_KEY       - Resend API key
//   SUPPORT_FROM_EMAIL   - verified from-address (optional; defaults below)
// If unset, this is a no-op so ticket creation never fails on email.
const SEV_LABEL: Record<number, string> = {
  1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Trivial",
};

export const notifySupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string }) => input)
  .handler(async ({ data }): Promise<{ emailed: boolean }> => {
    const to = process.env.SUPPORT_ALERT_EMAIL;
    const key = process.env.RESEND_API_KEY;
    if (!to || !key) return { emailed: false };

    const { data: t } = await supabaseAdmin
      .from("support_tickets" as never)
      .select("ref,category,severity,title,description,created_by_name,created_by_email,tenant_id,status")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (!t) return { emailed: false };
    const row = t as Record<string, unknown>;

    let company = "";
    if (row.tenant_id) {
      const { data: c } = await supabaseAdmin
        .from("companies" as never)
        .select("name")
        .eq("id", row.tenant_id as string)
        .maybeSingle();
      company = ((c as { name?: string } | null)?.name) ?? "";
    }

    const sev = Number(row.severity);
    const subject = `[${row.ref}] Sev${sev} ${SEV_LABEL[sev] ?? ""} - ${String(row.category)}: ${String(row.title)}`;
    const lines = [
      `Company: ${company}`,
      `Reported by: ${String(row.created_by_name ?? "")} (${String(row.created_by_email ?? "")})`,
      `Category: ${String(row.category)}`,
      `Severity: ${sev} (${SEV_LABEL[sev] ?? ""})`,
      "",
      "Description:",
      String(row.description ?? ""),
    ];
    const fromAddr = process.env.SUPPORT_FROM_EMAIL ?? "PrimeRoute Support <support@theprimeroute.co.uk>";

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromAddr, to: [to], subject, text: lines.join("\\n") }),
      });
      return { emailed: res.ok };
    } catch (e) {
      console.warn("[support] email failed:", e);
      return { emailed: false };
    }
  });
