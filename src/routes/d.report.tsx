import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d/report")({
  head: () => ({ meta: [{ title: "Report — Driver" }] }),
  component: ReportPage,
});

const CATEGORIES = ["Vehicle issue", "Traffic delay", "Customer issue", "Accident", "Other"] as const;

function ReportPage() {
  const driver = useDriverStore((s) => s.driver);
  const [cat, setCat] = useState<string>(CATEGORIES[0]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!driver) return;
    setLoading(true);
    try {
      await supabase.from("driver_events").insert({
        driver_id: driver.id, type: "DELAY_REPORT", payload: { category: cat, notes },
      } as never);
      setSent(true); setNotes("");
      setTimeout(() => setSent(false), 3000);
    } finally { setLoading(false); }
  };

  return (
    <div className="pt-6 px-4">
      <h1 className="text-2xl font-bold mb-4 text-foreground">Report</h1>
      <p className="text-sm text-muted-foreground mb-6">File an incident or delay. Dispatch will be notified.</p>

      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</label>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`text-sm font-semibold py-3 rounded-xl border transition ${
              cat === c ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-muted-foreground"
            }`}>{c}</button>
        ))}
      </div>

      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
        placeholder="Describe what happened…"
        className="w-full bg-card border border-border rounded-xl p-3 text-sm text-foreground focus:outline-none focus:border-primary mb-4" />

      <button onClick={submit} disabled={loading || !notes.trim()}
        className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">
        {loading ? "Sending…" : sent ? "✓ Sent" : "Submit report"}
      </button>
    </div>
  );
}
