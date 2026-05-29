import { createFileRoute } from "@tanstack/react-router";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d/shift")({
  head: () => ({ meta: [{ title: "My Shift" }] }),
  component: ShiftPage,
});

function ShiftPage() {
  const driver = useDriverStore((s) => s.driver);
  if (!driver) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-bold text-foreground">My Shift</h1>
      <ShiftCalendar driverId={driver.id} isPlanner={false} />
    </div>
  );
}
