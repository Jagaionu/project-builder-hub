import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as unknown as { from: (t: string) => any };

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@theprimeroute.co.uk";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

type Note = { id: string; driver_id: string; title: string; body: string | null; data: { url?: string } | null };
type Sub = { driver_id: string; endpoint: string; p256dh: string; auth: string };

// Sweep unsent driver notifications and push them to each driver subscription.
export async function dispatchDriverPush(): Promise<{ sent: number; pending: number }> {
  if (!configure()) return { sent: 0, pending: 0 };
  const { data: notesData } = await sb
    .from("driver_notifications")
    .select("id,driver_id,title,body,data")
    .eq("push_sent", false)
    .order("created_at", { ascending: true })
    .limit(100);
  const notes = (notesData ?? []) as Note[];
  if (notes.length === 0) return { sent: 0, pending: 0 };

  const driverIds = Array.from(new Set(notes.map((n) => n.driver_id)));
  const { data: subsData } = await sb
    .from("driver_push_subscriptions")
    .select("driver_id,endpoint,p256dh,auth")
    .in("driver_id", driverIds);
  const subsByDriver = new Map<string, Sub[]>();
  for (const s of (subsData ?? []) as Sub[]) {
    const arr = subsByDriver.get(s.driver_id) ?? [];
    arr.push(s);
    subsByDriver.set(s.driver_id, arr);
  }

  let sent = 0;
  for (const n of notes) {
    const subs = subsByDriver.get(n.driver_id) ?? [];
    const payload = JSON.stringify({
      title: n.title,
      body: n.body ?? "",
      url: n.data && n.data.url ? n.data.url : "/d",
      tag: n.id,
    });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await sb.from("driver_push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
    await sb.from("driver_notifications").update({ push_sent: true }).eq("id", n.id);
  }
  return { sent, pending: notes.length };
}
