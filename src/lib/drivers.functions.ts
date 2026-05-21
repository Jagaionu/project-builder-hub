import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Driver } from "@/lib/types";

export const getDriversSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      console.error("[drivers] Missing Supabase env vars for server fn");
      return { drivers: [] as Driver[] };
    }

    const supabase = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.from("drivers").select("*").order("name");
    if (error) {
      console.error("[drivers] fetch error:", error.message);
      return { drivers: [] as Driver[] };
    }

    return { drivers: (data ?? []) as Driver[] };
  } catch (err) {
    console.error("[drivers] unexpected error:", err);
    return { drivers: [] as Driver[] };
  }
});
