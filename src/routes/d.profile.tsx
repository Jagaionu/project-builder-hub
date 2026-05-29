import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDriverStore } from "@/lib/driver-store";
import { driverLogout } from "@/lib/driver-auth";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";
import { CalendarDays } from "lucide-react";

export const Route = createFileRoute("/d/profile")({
  head: () => ({ meta: [{ title: "Profile — Driver" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const driver = useDriverStore((s) => s.driver);
  const session = useDriverStore((s) => s.session);
  const navigate = useNavigate();

  return (
    <div className="pt-6 px-4 pb-6">
      <h1 className="text-2xl font-bold mb-6 text-foreground">Profile</h1>

      {/* Driver info card */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-4 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center mb-3">
          <span className="text-3xl">👤</span>
        </div>
        <p className="text-lg font-bold text-foreground">{driver?.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{session?.user?.email}</p>
      </div>

      {/* Shift Calendar */}
      {driver && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={18} style={{ color: "oklch(0.62 0.22 245)" }} />
            <h2 className="text-base font-bold text-foreground">My Schedule</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Select your regular working days. Tap a working day to mark it off. Tap any grey day to
            add it as an extra working day.
          </p>
          <ShiftCalendar driverId={driver.id} isPlanner={false} />
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={async () => {
          await driverLogout();
          navigate({ to: "/d/login" });
        }}
        className="w-full bg-destructive/15 text-destructive border border-destructive/40 font-semibold py-4 rounded-xl active:scale-[0.99] transition"
      >
        Sign out
      </button>
    </div>
  );
}
