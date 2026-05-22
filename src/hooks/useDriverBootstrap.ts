import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { watchPosition, haversineKm, type GPSPosition } from "@/lib/driver-gps";
import type { JobWithStops, DriverProfile } from "@/lib/driver-types";

async function loadDriver(userId: string) {
  const { data: driver } = await supabase
    .from("drivers")
    .select("id,user_id,name,status,available_tomorrow,last_update_time,current_lat,current_lon")
    .eq("user_id", userId)
    .maybeSingle();
  useDriverStore.getState().setDriver((driver as DriverProfile | null) ?? null);
  if (driver) await refreshJobs(driver.id);
}

async function refreshJobs(driverId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = today.toISOString().slice(0, 10);
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id,reference,status,for_date,planned_start_at,scheduled_at,assigned_driver_id,planned_driver_id,stops:job_stops(id,job_id,warehouse_id,kind,seq,arrived_at,scheduled_at,warehouse:warehouses(id,code,name,address,latitude,longitude))")
    .or(`assigned_driver_id.eq.${driverId},planned_driver_id.eq.${driverId}`)
    .gte("for_date", from)
    .order("planned_start_at", { ascending: true, nullsFirst: true });
  useDriverStore.getState().setJobs((jobs ?? []) as unknown as JobWithStops[]);
}

const MIN_INTERVAL_MS = 30_000;
const MIN_MOVE_KM = 0.05;

export function useDriverBootstrap() {
  const setSession = useDriverStore((s) => s.setSession);
  const setOnline = useDriverStore((s) => s.setOnline);
  const setGpsPosition = useDriverStore((s) => s.setGpsPosition);
  const lastSent = useRef<GPSPosition | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSession(session);
      if (session?.user) {
        loadDriver(session.user.id);
      } else {
        useDriverStore.getState().reset();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadDriver(data.session.user.id);
    });

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const stopWatch = watchPosition((p) => {
      setGpsPosition(p);
      const driver = useDriverStore.getState().driver;
      if (!driver) return;
      const prev = lastSent.current;
      const movedEnough = !prev || haversineKm(prev.lat, prev.lon, p.lat, p.lon) >= MIN_MOVE_KM;
      const timeEnough = !prev || p.ts - prev.ts >= MIN_INTERVAL_MS;
      if (!movedEnough && !timeEnough) return;
      lastSent.current = p;
      const now = new Date().toISOString();
      supabase.from("driver_positions").insert({ driver_id: driver.id, lat: p.lat, lon: p.lon }).then(() => {});
      supabase.from("drivers").update({ current_lat: p.lat, current_lon: p.lon, last_update_time: now }).eq("id", driver.id).then(() => {});
    });

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      stopWatch();
    };
  }, [setSession, setOnline, setGpsPosition]);

  const driverId = useDriverStore((s) => s.driver?.id);
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`driver-${driverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `assigned_driver_id=eq.${driverId}` }, () => refreshJobs(driverId))
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `planned_driver_id=eq.${driverId}` }, () => refreshJobs(driverId))
      .on("postgres_changes", { event: "*", schema: "public", table: "job_stops" }, () => refreshJobs(driverId))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driverId]);
}
