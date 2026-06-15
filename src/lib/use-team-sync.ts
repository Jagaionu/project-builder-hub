import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Live sync for a company's member/profile list across the super-admin company
// card and the company-admin Team tab. Member reads go through a service-role
// server function (not client RLS), so we use a broadcast channel rather than
// postgres_changes: whichever side writes calls the returned notify(), and every
// other subscriber on that company's channel re-fetches.
export function useTeamSync(
  companyId: string | null | undefined,
  enabled: boolean,
  onRemoteChange: () => void,
): () => void {
  const chRef = useRef<RealtimeChannel | null>(null);
  const cb = useRef(onRemoteChange);
  cb.current = onRemoteChange;

  useEffect(() => {
    if (!enabled || !companyId) return;
    const ch = supabase
      .channel(`team-members-${companyId}`)
      .on("broadcast", { event: "members-changed" }, () => cb.current())
      .subscribe();
    chRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      chRef.current = null;
    };
  }, [companyId, enabled]);

  // Tell other clients to refresh (self is not echoed, so call your own reload too).
  return () => {
    void chRef.current?.send({ type: "broadcast", event: "members-changed", payload: {} });
  };
}
