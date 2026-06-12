import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDriverStore } from "@/lib/driver-store";
import { driverLogout } from "@/lib/driver-auth";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";
import { BaseWarehouseSelector } from "@/components/driver/BaseWarehouseSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CalendarDays } from "lucide-react";

export const Route = createFileRoute("/d/profile")({
  head: () => ({ meta: [{ title: "Profile — Driver" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const session = useDriverStore((s) => s.session);
  const navigate = useNavigate();

  return (
    <div className="pt-6 px-4 pb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <button
            onClick={async () => {
              await driverLogout();
              navigate({ to: "/d/login" });
            }}
            className="text-xs font-semibold text-destructive border border-destructive/40 rounded-lg px-2.5 py-1.5 active:scale-95 transition"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Driver info card */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-4 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center mb-3">
          <span className="text-3xl">👤</span>
        </div>
        <p className="text-lg font-bold text-foreground">{driver?.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{session?.user?.email}</p>
      </div>

      {/* Base warehouse (editable) */}
      {driver && (
        <div className="mb-4">
          <BaseWarehouseSelector
            driverId={driver.id}
            homeWarehouseId={driver.home_warehouse_id}
            returnToBaseRequired={driver.return_to_base_required}
            onSaved={(next) =>
              setDriver({
                ...driver,
                home_warehouse_id: next.home_warehouse_id,
                return_to_base_required: next.return_to_base_required,
              })
            }
          />
        </div>
      )}

      {/* Shift Calendar */}
      {driver && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={18} style={{ color: "var(--primary)" }} />
            <h2 className="text-base font-bold text-foreground">My Schedule</h2>
          </div>
          <ShiftCalendar driverId={driver.id} isPlanner={false} />
        </div>
      )}
    </div>
  );
}
