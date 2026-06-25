import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { toast } from "sonner";

export type DriverNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
};

// Realtime driver notifications: toasts on arrival while the app is open, and
// exposes the list + unread count for an in-app bell. Backed by the
// driver_notifications table (populated by DB triggers).
export function useDriverNotifications() {
  const driverId = useDriverStore((s) => s.driver?.id ?? null);
  const [items, setItems] = useState<DriverNotification[]>([]);

  useEffect(() => {
    if (!driverId) return;
    let mounted = true;
    const sb = supabase as unknown as { from: (t: string) => any };
    const load = async () => {
      const { data } = await sb
        .from("driver_notifications")
        .select("id,type,title,body,read,created_at")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (mounted && data) setItems(data as DriverNotification[]);
    };
    void load();

    const channel = supabase
      .channel("rt-dn-" + driverId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "driver_notifications",
          filter: "driver_id=eq." + driverId,
        },
        (payload) => {
          const n = payload.new as unknown as DriverNotification;
          setItems((prev) => [n, ...prev].slice(0, 50));
          toast(n.title, { description: n.body ?? undefined });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  const unread = items.filter((n) => !n.read).length;
  const markAllRead = async () => {
    if (!driverId) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    const sb = supabase as unknown as { from: (t: string) => any };
    await sb
      .from("driver_notifications")
      .update({ read: true })
      .eq("driver_id", driverId)
      .eq("read", false);
  };

  return { items, unread, markAllRead };
}
