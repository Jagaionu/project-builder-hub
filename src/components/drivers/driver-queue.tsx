import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Driver } from "@/lib/types";

const ROW_HEIGHT = 76;

export const DriverQueue = memo(function DriverQueue({
  drivers,
  selectedDriverId,
  onSelect,
}: {
  drivers: Driver[];
  selectedDriverId: string | null;
  onSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => drivers, [drivers]);

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => shown[index]?.id ?? index,
  });

  return (
    <div
      ref={parentRef}
      className="border-r border-border overflow-y-auto h-full"
      style={{ background: "var(--background)" }}
    >
      <div
        className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0 z-10 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--sidebar-divider)",
          background: "var(--background)",
          backdropFilter: "blur(4px)",
        }}
      >
        <span>Names</span>
        <span
          className="inline-flex items-center justify-center size-5 rounded-full text-[10px] font-mono font-bold"
          style={{ background: "oklch(0.62 0.22 245 / 0.12)", color: "var(--primary-bright)" }}
        >
          {shown.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground text-center">
          <Users className="size-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-xs">No drivers match your filters.</p>
        </div>
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const driver = shown[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                  borderBottom: "1px solid var(--sidebar-divider)",
                }}
              >
                <DriverQueueRow
                  driver={driver}
                  active={selectedDriverId === driver.id}
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const DriverQueueRow = memo(function DriverQueueRow({
  driver,
  active,
  onSelect,
}: {
  driver: Driver;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const phone = driver.phone ?? "—";
  const initials =
    driver.name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const paired = !!(driver as { user_id?: string | null }).user_id;
  const avatarUrl =
    (driver as { avatar_status?: string | null }).avatar_status === "approved"
      ? ((driver as { avatar_url?: string | null }).avatar_url ?? null)
      : null;
  const susp = driver as { suspended?: boolean | null; suspended_until?: string | null };
  const suspended =
    !!susp.suspended &&
    (!susp.suspended_until || new Date(susp.suspended_until).getTime() > Date.now());

  return (
    <button
      onClick={() => onSelect(driver.id)}
      className={cn(
        "group flex h-full w-full items-center gap-3 px-4 text-left transition-colors",
        active
          ? "bg-primary/10 border-l-2 border-l-primary pl-[calc(1rem-2px)]"
          : "border-l-2 border-l-transparent hover:bg-surface",
      )}
    >
      {/* Avatar */}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className={cn(
            "size-9 shrink-0 rounded-full object-cover",
            active ? "ring-2 ring-primary" : "",
          )}
        />
      ) : (
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
            active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          {initials}
        </div>
      )}

      {/* Name + phone */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("truncate text-sm font-semibold", active ? "text-primary" : "text-foreground")}
          >
            {driver.name}
          </span>
          {suspended && (
            <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">
              Suspended
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground font-mono">{phone}</div>
      </div>

      {/* Pairing status */}
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold border",
          paired
            ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
            : "text-amber-600 bg-amber-500/10 border-amber-500/30",
        )}
        title={paired ? "Driver has signed in" : "Code issued — not signed in yet"}
      >
        <span
          className={cn("size-1.5 rounded-full", paired ? "bg-emerald-500" : "bg-amber-500")}
        />
        {paired ? "Paired" : "Pending"}
      </span>
    </button>
  );
});
