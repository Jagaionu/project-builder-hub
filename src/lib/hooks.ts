import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Driver, Warehouse, Job } from "@/lib/types";

export function useDrivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  useEffect(() => {
    let mounted = true;
    supabase.from("drivers").select("*").order("name").then(({ data }) => {
      if (mounted && data) setDrivers(data as Driver[]);
    });
    const ch = supabase.channel("rt-drivers")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, (payload) => {
        setDrivers((prev) => {
          if (payload.eventType === "INSERT") return [...prev, payload.new as Driver];
          if (payload.eventType === "UPDATE")
            return prev.map((d) => (d.id === (payload.new as Driver).id ? (payload.new as Driver) : d));
          if (payload.eventType === "DELETE")
            return prev.filter((d) => d.id !== (payload.old as Driver).id);
          return prev;
        });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return drivers;
}

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    supabase.from("warehouses").select("*").order("code").then(({ data }) => {
      if (data) setWarehouses(data as Warehouse[]);
    });
  }, []);
  return warehouses;
}

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let mounted = true;
    supabase.from("jobs").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      if (mounted && data) setJobs(data as Job[]);
    });
    const ch = supabase.channel("rt-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
        setJobs((prev) => {
          if (payload.eventType === "INSERT") return [payload.new as Job, ...prev];
          if (payload.eventType === "UPDATE")
            return prev.map((j) => (j.id === (payload.new as Job).id ? (payload.new as Job) : j));
          if (payload.eventType === "DELETE")
            return prev.filter((j) => j.id !== (payload.old as Job).id);
          return prev;
        });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return jobs;
}
