import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Driver } from "@/lib/types";

export const getDriversSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin.from("drivers").select("*").order("name");
  if (error) {
    throw new Error(error.message);
  }

  return {
    drivers: (data ?? []) as Driver[],
  };
});