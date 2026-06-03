import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Driver } from "@/lib/types";
import { usePendingTacho } from "@/lib/use-pending-tacho";

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
  const { byDriver, driverCount } = usePendingTacho();
  const [pendingOnly, setPendingOnly] = useState(false);
  const shown = useMemo(
    () => (pendingOnly ? drivers.filter((d) => byDriver[d.id]?.length) : drivers),
    [drivers, pendingOnly, byDriver],
  );

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
        style={{ borderBottom: "1px solid var(--sidebar-divider)", background: "color-mix(in oklab, var(--sidebar-bg-1) 95%, transparent)", backdropFilter: "blur(4px)" }}
      >
        <span>Names</span>
        {driverCount > 0 && (
          <button
            type="button"
            onClick={() => setPendingOnly((v) => !v)}
            title="Tachograph entries awaiting approval — click to filter"
            className="inline-flex items-center justify-center gap-0.5 min-w-5 h-5 px-1.5 rounded-full text-[10px] font-mono font-bold"
            style={{
              background: pendingOnly ? "oklch(0.80 0.18 72 / 0.95)" : "oklch(0.80 0.18 72 / 0.18)",
              color: pendingOnly ? "#1a1200" : "var(--warning)",
              border: "1px solid oklch(0.80 0.18 72 / 0.55)",
            }}
          >
            ! {driverCount}
          </button>
        )}
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
  const code = (driver as { login_code?: string | null }).login_code ?? "—";

  return (
    <button
      onClick={() => onSelect(driver.id)}
      className={cn(
        "w-full h-full text-left px-4 py-3 transition-colors",
        active
          ? "bg-primary/10 border-l-2 border-l-primary pl-[calc(1rem-2px)]"
          : "border-l-2 border-l-transparent hover:bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className={cn(
            "font-semibold truncate text-sm",
            active ? "text-primary" : "text-foreground",
          )}
        >
          {driver.name}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-2">
          <span className="font-mono">Phone:</span>
          <span className="font-mono text-xs text-foreground">{phone}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-2">
          <span className="font-mono">App Code:</span>
          <span className="font-mono text-xs text-foreground">{code}</span>
        </div>
      </div>
    </button>
  );
});
