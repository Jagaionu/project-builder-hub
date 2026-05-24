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

// ── Status colour palette (hex — needed for DivIcon HTML context) ─────────────
const S_COLOR: Record<string, { fill: string; glow: string }> = {
  AVAILABLE:  { fill: "#22c55e", glow: "rgba(34,197,94,0.45)" },
  ON_SHIFT:   { fill: "#60a5fa", glow: "rgba(96,165,250,0.45)" },
  ON_ROUTE:   { fill: "#22c55e", glow: "rgba(34,197,94,0.45)" },
  DELAYED:    { fill: "#f59e0b", glow: "rgba(245,158,11,0.45)" },
  OFF_SHIFT:  { fill: "#475569", glow: "rgba(71,85,105,0.20)" },
  ON_BREAK:   { fill: "#f59e0b", glow: "rgba(245,158,11,0.35)" },
};
const DEFAULT_COLOR = { fill: "#60a5fa", glow: "rgba(96,165,250,0.45)" };
const BG = "#0d1117";       // deep background behind markers
const ROUTE_COLOR = "#60a5fa";

function driverMarkerHtml(name: string, status: string, selected: boolean): string {
  const { fill, glow } = S_COLOR[status] ?? DEFAULT_COLOR;
  const initial = (name?.[0] ?? "?").toUpperCase();
  const size = selected ? 36 : 28;
  const fontSize = selected ? 14 : 11;
  const border = selected ? `3px solid #fff` : `2.5px solid ${BG}`;
  const shadow = selected
    ? `0 0 0 3px ${fill},0 0 24px ${glow},0 6px 20px rgba(0,0,0,0.7)`
    : `0 0 0 1.5px ${fill},0 0 12px ${glow},0 2px 8px rgba(0,0,0,0.5)`;
  const pulse = (status !== "OFF_SHIFT" && !selected)
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:1.5px solid ${fill};animation:ping-slow 2.4s cubic-bezier(0,0,0.2,1) infinite;pointer-events:none"></div>`
    : "";
  return `
    <div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${fill};border:${border};
      box-shadow:${shadow};
      display:flex;align-items:center;justify-content:center;
      font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:${fontSize}px;color:#fff;
      cursor:pointer;position:relative;
      ${selected ? "z-index:1000;" : ""}
    ">
      ${initial}
      ${pulse}
    </div>`;
}

function warehouseMarkerHtml(code: string): string {
  const label = code.length > 4 ? code.slice(0, 4) : code;
  return `
    <div style="
      background:#f59e0b;border:2px solid ${BG};border-radius:6px;
      padding:2px 6px;
      font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:9px;
      color:${BG};white-space:nowrap;
      box-shadow:0 2px 10px rgba(0,0,0,0.55),0 0 0 1px rgba(245,158,11,0.35);
    ">
      ${label}
    </div>`;
}

function popupHtml(title: string, sub: string, extra = ""): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:120px">
      <div style="font-weight:600;font-size:13px;color:#f1f5f9">${title}</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:.06em">${sub}</div>
      ${extra ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${extra}</div>` : ""}
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

    // Disable OSM CSS filter — CartoDB tiles are natively dark
    const styleId = "carto-tile-fix";
    if (!document.getElementById(styleId)) {
      const s = document.createElement("style");
      s.id = styleId;
      s.textContent = ".leaflet-tile { filter: none !important; }";
      document.head.appendChild(s);
    }

    const map = L.map(containerRef.current, {
      center: [53.5, -1.5],
      zoom: 6,
      zoomControl: false,
      attributionControl: true,
    });

    // CartoDB Dark Matter — proper dark basemap
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      },
    ).addTo(map);

    // Zoom control — bottom right
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
      maxZoom: 9,
      duration: 1.2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        iconAnchor: [0, 0],
      });
      const popup = L.popup({ className: "dark-popup", offset: [0, -4] }).setContent(
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
        iconSize:   isSelected ? [36, 36] : [28, 28],
        iconAnchor: isSelected ? [18, 18] : [14, 14],
      });

      const activeJob = jobs.find(
        (j) => j.assigned_driver_id === d.id &&
          ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
      );
      const extra = activeJob ? `Job: <b>${activeJob.reference}</b>` : "";
      const lastSeen = d.last_update_time
        ? `GPS: ${new Date(d.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const popup = L.popup({ className: "dark-popup", offset: [0, -6] }).setContent(
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

    // Just pan to driver if no active job
    if (!activeJob) {
      mapRef.current?.flyTo([selectedDriver.current_lat, selectedDriver.current_lon], 11, {
        duration: 1.0,
        easeLinearity: 0.3,
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

    // Soft glow backdrop
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 10,
      opacity: 0.10,
      lineCap: "round",
    }).addTo(layer);

    // Mid-glow
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 4,
      opacity: 0.20,
      lineCap: "round",
    }).addTo(layer);

    // Animated dash line (uses .route-line keyframe from styles.css)
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 2.5,
      opacity: 0.90,
      dashArray: "8 5",
      className: "route-line",
      lineCap: "round",
    }).addTo(layer);

    // Destination circle pulse
    L.circleMarker(to, {
      radius: 7,
      fillColor: ROUTE_COLOR,
      fillOpacity: 0.9,
      color: BG,
      weight: 2,
    })
      .bindPopup(L.popup({ className: "dark-popup" }).setContent(
        popupHtml(destWh.name, destWh.code),
      ))
      .addTo(layer);

    // Outer ring on destination
    L.circleMarker(to, {
      radius: 13,
      fillColor: "transparent",
      fillOpacity: 0,
      color: ROUTE_COLOR,
      weight: 1.5,
      opacity: 0.40,
    }).addTo(layer);

    // Fly to show both points
    mapRef.current?.flyToBounds(L.latLngBounds([from, to]), {
      padding: [90, 90],
      maxZoom: 10,
      duration: 1.1,
      easeLinearity: 0.3,
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
    <div className="absolute inset-0">
      {/* Leaflet container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Status overlay — bottom left ─────────────────────────────────── */}
      <div
        className="absolute bottom-6 left-3 z-[999] flex flex-col gap-1.5"
        style={{ pointerEvents: "none" }}
      >
        {/* Total on map */}
        <div
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
          style={{
            background: "oklch(0.15 0.018 245 / 0.88)",
            border: "1px solid oklch(0.26 0.018 245 / 0.6)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ background: "#60a5fa", boxShadow: "0 0 4px rgba(96,165,250,0.6)" }}
          />
          <span className="text-[11px] font-mono font-semibold" style={{ color: "#60a5fa" }}>
            {overlayStats.onMap}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            on map
          </span>
          {overlayStats.offline > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/50">
              · {overlayStats.offline} offline
            </span>
          )}
        </div>

        {/* Active drivers */}
        {overlayStats.active > 0 && (
          <div
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{
              background: "oklch(0.15 0.018 245 / 0.88)",
              border: "1px solid oklch(0.26 0.018 245 / 0.6)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span
              className="size-1.5 rounded-full shrink-0"
              style={{ background: "#22c55e", boxShadow: "0 0 4px rgba(34,197,94,0.6)", animation: "pulse 2s ease infinite" }}
            />
            <span className="text-[11px] font-mono font-semibold" style={{ color: "#22c55e" }}>
              {overlayStats.active}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              active
            </span>
          </div>
        )}

        {/* Delayed */}
        {overlayStats.delayed > 0 && (
          <div
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{
              background: "oklch(0.63 0.22 20 / 0.08)",
              border: "1px solid oklch(0.63 0.22 20 / 0.35)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span
              className="size-1.5 rounded-full shrink-0"
              style={{ background: "#f59e0b", boxShadow: "0 0 4px rgba(245,158,11,0.6)" }}
            />
            <span className="text-[11px] font-mono font-semibold" style={{ color: "#f59e0b" }}>
              {overlayStats.delayed}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.72 0.18 20)" }}>
              delayed
            </span>
          </div>
        )}
      </div>

      {/* ── Selected driver label — top center ───────────────────────────── */}
      {selectedDriver && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[999]"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{
              background: "oklch(0.15 0.018 245 / 0.92)",
              border: "1px solid oklch(0.62 0.22 245 / 0.4)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 0 0 1px oklch(0.62 0.22 245 / 0.15), 0 4px 16px rgba(0,0,0,0.4)",
            }}
          >
            <span
              className="size-2 rounded-full shrink-0"
              style={{
                background: S_COLOR[selectedDriver.status]?.fill ?? "#60a5fa",
                boxShadow: `0 0 6px ${S_COLOR[selectedDriver.status]?.glow ?? "rgba(96,165,250,0.5)"}`,
                animation: "pulse 2s ease infinite",
              }}
            />
            <span className="text-xs font-semibold text-foreground">{selectedDriver.name}</span>
            <span
              className="text-[10px] font-mono uppercase tracking-wider"
              style={{ color: "oklch(0.55 0.014 245)" }}
            >
              {selectedDriver.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
