import { useEffect, useLayoutEffect, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import { Check, User } from "lucide-react";
import type { Compliance } from "@/lib/compliance";
import { JOB_STATUSES, STATUS_CONFIG, type EffectiveStatus } from "@/lib/dispatch/status";

// ── usePopover ──────────────────────────────────────────────────────────────

export function usePopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: r.left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return { open, setOpen, btnRef, popRef, coords };
}

// ── ComplianceDot ───────────────────────────────────────────────────────────

export const ComplianceDot = memo(function ComplianceDot({
  c, driverStatus,
}: {
  c: Compliance;
  driverStatus?: string;
}) {
  const activeStatus = driverStatus && driverStatus !== "OFF_SHIFT";
  const offShift = !c.onShift && !activeStatus;
  const cls = offShift
    ? "bg-muted-foreground/40"
    : c.status === "breach"
      ? "bg-destructive"
      : c.status === "warn"
        ? "bg-warning"
        : "bg-success";
  const title = offShift
    ? `Off shift · ${c.restHours === Infinity ? "—" : c.restHours.toFixed(1) + "h rest"}`
    : (c.issues[0]?.msg ?? `OK · ${c.daily.toFixed(1)}/10 today · ${c.weekly.toFixed(1)}/56 this week`);
  return <span title={title} className={`size-1.5 rounded-full shrink-0 ${cls}`} />;
});

// ── PlannedChip ─────────────────────────────────────────────────────────────

export const PlannedChip = memo(function PlannedChip({
  driverName, sequence, startAt, distanceKm, dailyHoursLeft,
}: {
  driverName: string;
  sequence?: number;
  startAt?: string;
  distanceKm?: number;
  dailyHoursLeft?: number;
}) {
  const when = startAt
    ? new Date(startAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const isChained = sequence && sequence > 1;
  return (
    <div
      title={isChained ? "Chained follow-on assignment — part of a multi-route sequence" : "Planned follow-on assignment — not confirmed yet"}
      className={`mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono ${
        isChained
          ? "bg-blue-500/10 text-blue-600 border border-blue-500/30"
          : "bg-muted/40 text-muted-foreground"
      }`}
    >
      <span className={`size-1 rounded-full ${
        isChained ? "bg-blue-500" : "bg-muted-foreground/60"
      }`} />
      {isChained ? "⛓ " : ""}planned: {driverName}
      {sequence ? ` · #${sequence}` : ""}
      {when ? ` · ${when}` : ""}
      {distanceKm != null ? ` · ${distanceKm.toFixed(0)}km away` : ""}
      {dailyHoursLeft != null ? ` · ${dailyHoursLeft.toFixed(1)}h left` : ""}
    </div>
  );
});

// ── StatusPill ──────────────────────────────────────────────────────────────

export function StatusPill({
  status, onChange,
}: {
  status: EffectiveStatus | string;
  onChange: (s: string) => void;
}) {
  const { open, setOpen, btnRef, popRef, coords } = usePopover();
  const cfg = STATUS_CONFIG[status as EffectiveStatus] ?? STATUS_CONFIG.PENDING;
  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 select-none ${cfg.badge}`}
      >
        <span className={`size-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[1000] w-48 rounded-xl border border-border bg-popover shadow-xl py-1.5"
        >
          {JOB_STATUSES.map((s) => {
            const c = STATUS_CONFIG[s];
            const active = s === status;
            return (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
              >
                <span className={`size-2 rounded-full shrink-0 ${c.dot}`} />
                <span className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {c.label}
                </span>
                {active && <Check className="size-3 text-foreground" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── DriverPicker ────────────────────────────────────────────────────────────

export function DriverPicker({
  driverId, allowUnassign = true, drivers, compliance, onChange,
}: {
  driverId: string | null | undefined;
  allowUnassign?: boolean;
  drivers: { id: string; name: string; status?: string }[];
  compliance?: Record<string, Compliance>;
  onChange: (id: string) => void;
}) {
  const { open, setOpen, btnRef, popRef, coords } = usePopover();
  const driver = drivers.find((d) => d.id === driverId);
  const activeC = driver ? compliance?.[driver.id] : undefined;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {driver ? (
          <>
            <span className="size-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
              {driver.name[0]?.toUpperCase()}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{driver.name}</span>
            {activeC && <ComplianceDot c={activeC} driverStatus={driver.status} />}
          </>
        ) : (
          <>
            <span className="size-7 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
              <User className="size-3.5 text-muted-foreground/50" />
            </span>
            <span className="text-sm text-muted-foreground">Unassigned — click to assign</span>
          </>
        )}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[1000] w-52 rounded-xl border border-border bg-popover shadow-xl py-1.5 max-h-[60vh] overflow-y-auto"
        >
          {allowUnassign && (
            <>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
              >
                <span className="size-6 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
                  <User className="size-3 text-muted-foreground/40" />
                </span>
                <span className={`flex-1 text-left ${!driverId ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  Unassigned
                </span>
                {!driverId && <Check className="size-3 text-foreground" />}
              </button>
              {drivers.length > 0 && <div className="my-1 border-t border-border/50" />}
            </>
          )}
          {drivers.map((d) => {
            const active = d.id === driverId;
            const dc = compliance?.[d.id];
            const blocked = !!dc?.blockAssignment;
            return (
              <button
                key={d.id}
                type="button"
                disabled={blocked}
                onClick={() => { if (!blocked) { onChange(d.id); setOpen(false); } }}
                title={blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-2"}`}
              >
                <span className="size-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                  {d.name[0]?.toUpperCase()}
                </span>
                <span className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {d.name}
                  {dc && (
                    <span className="ml-1 text-[9px] font-mono text-muted-foreground/70">
                      {dc.weekly.toFixed(0)}/56 · {dc.dailyHeadroom.toFixed(1)}h left
                    </span>
                  )}
                </span>
                {dc && <ComplianceDot c={dc} driverStatus={d.status} />}
                {active && <Check className="size-3 text-foreground" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
