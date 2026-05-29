import { createFileRoute } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { useDriverStore } from "@/lib/driver-store";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";

export const Route = createFileRoute("/d/shift")({
  head: () => ({ meta: [{ title: "My Shift — Driver" }] }),
  component: ShiftPage,
});

function ShiftPage() {
  const driver = useDriverStore(s => s.driver);

  if (!driver) return (
    <div className="pt-6 px-4">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );

  return (
    <div className="pt-6 px-4 pb-6">
      <div className="flex items-center gap-2 mb-2">
        <Calendar size={22} style={{ color: "oklch(0.62 0.22 245)" }} />
        <h1 className="text-2xl font-bold text-foreground">My Shift</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Set your working days and mark holidays. Tap a working day to mark it off, tap a holiday to restore it.
      </p>
      <ShiftCalendar driverId={driver.id} isPlanner={false} />
    </div>
  );
}
