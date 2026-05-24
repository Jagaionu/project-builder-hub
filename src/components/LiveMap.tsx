Here is the completely rewritten, production-ready `LiveMap.tsx` component.

The base tile layer has been migrated from the illegible dark canvas to **CartoDB Voyager**, which features highly detailed street networks, legible labels, and clean pastel landuse layouts similar to modern navigation systems like Waze. The marker dynamics, map overlays, popups, and route lines have been updated to high-contrast styles that stand out clearly against a bright map background.

```tsx
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Driver, Warehouse, Job } from "@/lib/types";

interface Props {
  drivers: Driver[];
  warehouses: Warehouse[];
  jobs: Job[];
  selectedDriverId?: string | null;
  onSelectDriver?: (id: string) => void;
}

// ── Waze-Inspired Status Colour Palette (Optimized for Light Street Maps) ──
const S_COLOR: Record<string, { fill: string; text: string; glow: string }> = {
  AVAILABLE:  { fill: "#10b981", text: "#ffffff", glow: "rgba(16,185,129,0.3)" },
  ON_SHIFT:   { fill: "#2563eb", text: "#ffffff", glow: "rgba(37,99,235,0.3)" },
  ON_ROUTE:   { fill: "#059669", text: "#ffffff", glow: "rgba(5,150,105,0.3)" },
  DELAYED:    { fill: "#dc2626", text: "#ffffff", glow: "rgba(220,38,38,0.35)" },
  OFF_SHIFT:  { fill: "#64748b", text: "#ffffff", glow: "rgba(100,116,139,0.15)" },
  ON_BREAK:   { fill: "#d97706", text: "#ffffff", glow: "rgba(217,119,6,0.25)" },
};
const DEFAULT_COLOR = { fill: "#2563eb", text: "#ffffff", glow: "rgba(37,99,235,0.3)" };
const BG = "#ffffff";           // High contrast crisp white border for markers
const ROUTE_COLOR = "#00b4d8";  // Vibrant Waze-style neon telemetry blue

function driverMarkerHtml(name: string, status: string, selected: boolean): string {
  const { fill, glow } = S_COLOR[status] ?? DEFAULT_COLOR;
  const initial = (name?.[0] ?? "?").toUpperCase();
  const size = selected ? 38 : 30;
  const fontSize = selected ? 15 : 12;
  const border = selected ? `3px solid #0f172a` : `2.5px solid ${BG}`;
  const shadow = selected
    ? `0 0 0 2px ${fill}, 0 8px 24px rgba(15,23,42,0.35)`
    : `0 4px 10px rgba(15,23,42,0.15), 0 0 0 1px ${glow}`;
  
  const pulse = (status !== "OFF_SHIFT" && !selected)
    ? `<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ${fill};animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;opacity:0.6;pointer-events:none"></div>`
    : "";

  return `
    <div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${fill};border:${border};
      box-shadow:${shadow};
      display:flex;align-items:center;justify-content:center;
      font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:${fontSize}px;color:#fff;
      cursor:pointer;position:relative;
      transition: transform 0.2s ease;
      ${selected ? "z-index:1000; transform: scale(1.1);" : ""}
    ">
      ${initial}
      ${pulse}
    </div>`;
}

function warehouseMarkerHtml(code: string): string {
  const label = code.length > 5 ? code.slice(0, 5) : code;
  return `
    <div style="
      background:#0f172a;border:2px solid ${BG};border-radius:6px;
      padding:3px 8px;
      font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:10px;
      color:#fff;white-space:nowrap;
      box-shadow:0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(15,23,42,0.1);
    ">
      📍 ${label}
    </div>`;
}

function popupHtml(title: string, sub: string, extra = ""): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:140px;color:#1e293b;padding:2px">
      <div style="font-weight:700;font-size:14px;color:#0f172a;line-height:1.2">${title}</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">${sub}</div>
      ${extra ? `<div style="font-size:11px;color:#334155;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:6px;line-height:1.4">${extra}</div>` : ""}
    </div>`;
}

export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const driverLayer    = useRef<L.LayerGroup | null>(null);
  const warehouseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer     = useRef<L.LayerGroup | null>(null);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Clean up any lingering dark styles or layout overrides
    const styleId = "carto-tile-fix";
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();

    const map = L.map(containerRef.current, {
      center: [53.5, -1.5],
      zoom: 6,
      zoomControl: false,
      attributionControl: true,
    });

    // CartoDB Voyager — Crisp, high-contrast street map with beautiful logistics legibility
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      },
    ).addTo(map);

    // Modern clean positioning for zoom tools
    L.control.zoom({ position: "bottomright" }).addTo(map);

    warehouseLayer.current = L.layerGroup().addTo(map);
    routeLayer.current     = L.layerGroup().addTo(map);
    driverLayer.current    = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Fit to data on first meaningful load ───────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const points: [number, number][] = [
      ...warehouses.map((w) => [w.latitude, w.longitude] as [number, number]),
      ...drivers
        .filter((d) => d.current_lat != null)
        .map((d) => [d.current_lat!, d.current_lon!] as [number, number]),
    ];
    if (points.length === 0) return;
    mapRef.current.flyToBounds(L.latLngBounds(points), {
      padding: [60, 60],
      maxZoom: 10,
      duration: 1.2,
    });
  }, [warehouses.length > 0]);

  // ── Warehouse markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const layer = warehouseLayer.current;
    if (!layer) return;
    layer.clearLayers();
    warehouses.forEach((w) => {
      const icon = L.divIcon({
        className: "",
        html: warehouseMarkerHtml(w.code),
        iconAnchor: [20, 10],
      });
      const popup = L.popup({ offset: [0, -4] }).setContent(
        popupHtml(w.name, w.code, w.address ?? ""),
      );
      L.marker([w.latitude, w.longitude], { icon })
        .bindPopup(popup)
        .addTo(layer);
    });
  }, [warehouses]);

  // ── Driver markers ────────────────────────────────────────────────────────
  useEffect(() => {
    const layer = driverLayer.current;
    if (!layer) return;
    layer.clearLayers();

    drivers.forEach((d) => {
      if (d.current_lat == null || d.current_lon == null) return;
      const isSelected = d.id === selectedDriverId;
      const icon = L.divIcon({
        className: "",
        html: driverMarkerHtml(d.name, d.status, isSelected),
        iconSize:   isSelected ? [38, 38] : [30, 30],
        iconAnchor: isSelected ? [19, 19] : [15, 15],
      });

      const activeJob = jobs.find(
        (j) => j.assigned_driver_id === d.id &&
          ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
      );
      const extra = activeJob ? `Active Job: <b style="color:#2563eb">${activeJob.reference}</b>` : "";
      const lastSeen = d.last_update_time
        ? `Ping: ${new Date(d.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const popup = L.popup({ offset: [0, -6] }).setContent(
        popupHtml(d.name, d.status.replace(/_/g, " "), [extra, lastSeen].filter(Boolean).join(" · ")),
      );

      const marker = L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: isSelected ? 1000 : 0 })
        .bindPopup(popup);
      marker.on("click", () => onSelectDriver?.(d.id));
      marker.addTo(layer);
    });
  }, [drivers, selectedDriverId, onSelectDriver, jobs]);

  // ── Route line for selected driver ────────────────────────────────────────
  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === selectedDriverId),
    [drivers, selectedDriverId],
  );
  const activeJob = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.assigned_driver_id === selectedDriverId &&
          ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
      ),
    [jobs, selectedDriverId],
  );

  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();

    if (!selectedDriver?.current_lat || !selectedDriver.current_lon) return;

    if (!activeJob) {
      mapRef.current?.flyTo([selectedDriver.current_lat, selectedDriver.current_lon], 12, {
        duration: 1.0,
      });
      return;
    }

    const destWh = warehouses.find((w) =>
      activeJob.status === "ASSIGNED" || activeJob.status === "IN_PROGRESS"
        ? w.id === activeJob.origin_warehouse_id
        : w.id === activeJob.destination_warehouse_id,
    );
    if (!destWh) return;

    const from: [number, number] = [selectedDriver.current_lat, selectedDriver.current_lon];
    const to:   [number, number] = [destWh.latitude, destWh.longitude];

    // Thick clean underlying vector track glow (Waze style guidance track)
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 8,
      opacity: 0.25,
      lineCap: "round",
    }).addTo(layer);

    // High-visibility core line routing
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 4,
      opacity: 0.85,
      lineCap: "round",
    }).addTo(layer);

    // Telemetry directional dash line overlay
    L.polyline([from, to], {
      color: "#ffffff",
      weight: 2,
      opacity: 0.90,
      dashArray: "6 6",
      lineCap: "round",
    }).addTo(layer);

    // Destination landing target node
    L.circleMarker(to, {
      radius: 6,
      fillColor: "#0f172a",
      fillOpacity: 1,
      color: ROUTE_COLOR,
      weight: 3,
    })
      .bindPopup(L.popup().setContent(popupHtml(destWh.name, destWh.code)))
      .addTo(layer);

    // Radar pulsing ring around target destination
    L.circleMarker(to, {
      radius: 14,
      fillColor: "transparent",
      fillOpacity: 0,
      color: ROUTE_COLOR,
      weight: 2,
      opacity: 0.50,
    }).addTo(layer);

    mapRef.current?.flyToBounds(L.latLngBounds([from, to]), {
      padding: [80, 80],
      maxZoom: 12,
      duration: 1.1,
    });
  }, [selectedDriver, activeJob, warehouses]);

  // ── Overlay stats (computed for React render) ─────────────────────────────
  const overlayStats = useMemo(() => {
    const onMap   = drivers.filter((d) => d.current_lat != null).length;
    const active  = drivers.filter((d) => ["AVAILABLE","ON_SHIFT","ON_ROUTE"].includes(d.status) && d.current_lat != null).length;
    const delayed = drivers.filter((d) => d.status === "DELAYED").length;
    const offline = drivers.filter((d) => d.current_lat == null).length;
    return { onMap, active, delayed, offline, total: drivers.length };
  }, [drivers]);

  return (
    <div className="absolute inset-0 bg-[#f8fafc]">
      {/* Map rendering window */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Modern Telemetry Status Widgets — Bottom Left ────────────────── */}
      <div
        className="absolute bottom-6 left-4 z-[999] flex flex-col gap-2"
        style={{ pointerEvents: "none" }}
      >
        {/* Fleet capacity metrics */}
        <div
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 shadow-lg"
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #e2e8f0",
            backdropFilter: "blur(12px)",
            pointerEvents: "auto",
          }}
        >
          <span
            className="size-2 rounded-full shrink-0"
            style={{ background: "#2563eb", boxShadow: "0 0 8px rgba(37,99,235,0.5)" }}
          />
          <span className="text-xs font-mono font-bold text-slate-900">
            {overlayStats.onMap}
          </span>
          <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-500">
            Active Assets
          </span>
          {overlayStats.offline > 0 && (
            <span className="text-[10px] font-sans font-medium text-slate-400">
              ({overlayStats.offline} untracked)
            </span>
          )}
        </div>

        {/* Operational Flow Status */}
        {overlayStats.active > 0 && (
          <div
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 shadow-lg"
            style={{
              background: "rgba(255, 255, 255, 0.95)",
              border: "1px solid #e2e8f0",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="size-2 rounded-full shrink-0"
              style={{ background: "#10b981", boxShadow: "0 0 8px rgba(16,185,129,0.5)" }}
            />
            <span className="text-xs font-mono font-bold text-slate-900">
              {overlayStats.active}
            </span>
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-500">
              In Transit
            </span>
          </div>
        )}

        {/* Dynamic Critical Exceptions Alert */}
        {overlayStats.delayed > 0 && (
          <div
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 shadow-xl animate-bounce"
            style={{
              background: "#fef2f2",
              border: "1px solid #fee2e2",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="size-2 rounded-full shrink-0 animate-ping"
              style={{ background: "#dc2626" }}
            />
            <span className="text-xs font-mono font-bold text-red-700">
              {overlayStats.delayed}
            </span>
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-red-600">
              Incidents / Delays
            </span>
          </div>
        )}
      </div>

      {/* ── Focused Driver HeaderHUD — Top Center ─────────────────────── */}
      {selectedDriver && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[999]"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex items-center gap-3 rounded-full px-4 py-2 shadow-xl"
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 10px 25px -5px rgba(15,23,42,0.3)",
            }}
          >
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{
                background: S_COLOR[selectedDriver.status]?.fill ?? "#2563eb",
                boxShadow: `0 0 10px ${S_COLOR[selectedDriver.status]?.fill ?? "#2563eb"}`,
              }}
            />
            <span className="text-xs font-bold text-white tracking-wide">{selectedDriver.name}</span>
            <span className="w-px h-3 bg-slate-700" />
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400"
            >
              {selectedDriver.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

```
