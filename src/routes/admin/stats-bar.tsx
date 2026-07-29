import { CheckCircle, Clock, Ban, AlertTriangle, Building2, XCircle } from "lucide-react";
import type { Company } from "@/lib/types";

interface StatsBarProps {
  companies: Company[];
}

export function StatsBar({ companies }: StatsBarProps) {
  const total = companies.length;
  const active = companies.filter((c) => c.subscription_status === "active").length;
  const trial = companies.filter((c) => c.subscription_status === "trial").length;
  const suspended = companies.filter((c) => c.subscription_status === "suspended").length;
  const cancelled = companies.filter((c) => c.subscription_status === "cancelled").length;

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const expiringTrials = companies.filter(
    (c) =>
      c.subscription_status === "trial" &&
      c.subscription_ends_at &&
      new Date(c.subscription_ends_at) <= in7Days &&
      new Date(c.subscription_ends_at) > now,
  );
  const hasUrgentExpiry = expiringTrials.some((c) => {
    const daysLeft = Math.ceil(
      (new Date(c.subscription_ends_at!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    return daysLeft <= 3;
  });

  const stats = [
    { label: "Companies", value: total, icon: Building2, color: "text-foreground" },
    { label: "Active", value: active, icon: CheckCircle, color: "text-success" },
    { label: "Trial", value: trial, icon: Clock, color: "text-warning" },
    { label: "Suspended", value: suspended, icon: Ban, color: "text-destructive" },
    {
      label: "Cancelled",
      value: cancelled,
      icon: XCircle,
      color: cancelled > 0 ? "text-destructive" : "text-muted-foreground",
    },
    {
      label: "Expiring",
      value: expiringTrials.length,
      icon: AlertTriangle,
      color: hasUrgentExpiry ? "text-destructive" : "text-warning",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="stat-card flex items-center gap-3">
          <Icon className={`size-4 shrink-0 ${color}`} />
          <div>
            <div className="text-lg font-semibold leading-none">{value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsBarSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="stat-card flex items-center gap-3">
          <div className="skeleton size-4 rounded shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-5 w-8 rounded" />
            <div className="skeleton h-3 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
