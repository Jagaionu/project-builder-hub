import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDriverStore } from "@/lib/driver-store";
import { driverLogout } from "@/lib/driver-auth";

export const Route = createFileRoute("/d/profile")({
  head: () => ({ meta: [{ title: "Profile — Driver" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const driver = useDriverStore((s) => s.driver);
  const session = useDriverStore((s) => s.session);
  const navigate = useNavigate();

  return (
    <div className="pt-6 px-4">
      <h1 className="text-2xl font-bold mb-6 text-foreground">Profile</h1>

      <div className="bg-card border border-border rounded-2xl p-5 mb-4 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center mb-3">
          <span className="text-3xl">👤</span>
        </div>
        <p className="text-lg font-bold text-foreground">{driver?.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{session?.user?.email}</p>
      </div>

      <div className="bg-card border border-border rounded-2xl divide-y divide-border mb-6">
        <Row label="Status" value={driver?.status ?? "—"} />
        <Row label="Available tomorrow" value={driver?.available_tomorrow ? "Yes" : "No"} />
        <Row label="Last update" value={driver?.last_update_time ? new Date(driver.last_update_time).toLocaleString() : "—"} />
      </div>

      <button onClick={async () => { await driverLogout(); navigate({ to: "/d/login" }); }}
        className="w-full bg-destructive/15 text-destructive border border-destructive/40 font-semibold py-4 rounded-xl active:scale-[0.99] transition">
        Sign out
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
