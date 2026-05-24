import { useEffect, useMemo, useRef, useState } from "react";
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

// ── Color palette for statuses (now tuned for light background) ─────────────
const S_COLOR: Record<string, { fill: string; glow: string; text: string }> = {
  AVAILABLE:   { fill: "#22c55e", glow: "rgba(34,197,94,0.3)", text: "#0f172a" },
  ON_SHIFT:    { fill: "#3b82f6", glow: "rgba(59,130,246,0.3)", text: "#fff" },
  ON_ROUTE:    { fill: "#22c55e", glow: "rgba(34,197,94,0.3)", text: "#0f172a" },
  DELAYED:     { fill: "#f59e0b", glow: "rgba(245,158,11,0.3)", text: "#0f172a" },
  OFF_SHIFT:   { fill: "#94a3b8", glow: "rgba(148,163,184,0.2)", text: "#0f172a" },
  ON_BREAK:    { fill: "#f59e0b", glow: "rgba(245,158,11,0.3)", text: "#0f172a" },
};
const DEFAULT_COLOR = { fill: "#3b82f6", glow: "rgba(59,130,246,0.3)", text: "#fff" };
const BG = "#ffffff";           // Light background for marker borders
const ROUTE_COLOR = "#2563eb";  // Strong blue for route lines

function driverMarkerHtml(name: string, status: string, selected: boolean): string {
  const { fill, glow, text } = S_COLOR[status] ?? DEFAULT_COLOR;
  const initial = (name?.[0] ?? "?").toUpperCase();
  const size = selected ? 38 : 30;
  const fontSize = selected ? 15 : 12;
  const border = selected ? `3px solid #0f172a` : `2.5px solid ${BG}`;
  const shadow = selected
    ? `0 0 0 3px ${fill},0 0 16px ${glow},0 4px 12px rgba(0,0,0,0.15)`
    : `0 0 0 1.5px ${fill},0 0 10px ${glow},0 2px 6px rgba(0,0,0,0.1)`;
  const pulse = (status !== "OFF_SHIFT" && !selected)
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:1.5px solid ${fill};animation:ping-slow 2.4s cubic-bezier(0,0,0.2,1) infinite;pointer-events:none"></div>`
    : "";
  return `
    <div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${fill};border:${border};
      box-shadow:${shadow};
      display:flex;align-items:center;justify-content:center;
      font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:${fontSize}px;color:${text};
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
      background:#f59e0b;border:2px solid ${BG};border-radius:8px;
      padding:3px 8px;
      font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:10px;
      color:${BG};white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.15),0 0 0 1px rgba(245,158,11,0.4);
    ">
      ${label}
    </div>`;
}

function popupHtml(title: string, sub: string, extra = ""): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:140px;color:#0f172a">
      <div style="font-weight:600;font-size:14px;color:#0f172a">${title}</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#334155;margin-top:4px;text-transform:uppercase;letter-spacing:.06em">${sub}</div>
      ${extra ? `<div style="font-size:12px;color:#475569;margin-top:5px">${extra}</div>` : ""}
    </div>`;
}

export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const driverLayer    = useRef<L.LayerGroup | null>(null);
  const warehouseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer     = useRef<L.LayerGroup | null>(null);

  // New state for manual distance/eta calculation
  const [selectedCalcDriver, setSelectedCalcDriver] = useState<Driver | null>(null);
  const [calcResult, setCalcResult] = useState<{ distanceKm: number; minutes: number } | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  // ── Init map once (light CartoDB Voyager) ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [53.5, -1.5],
      zoom: 6,
      zoomControl: false,
      attributionControl: true,
    });

    // Light, Waze‑like basemap
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      },
    ).addTo(map);

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

  // ── Fit to data on first load ───────────────────────────────────────────
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
  }, [warehouses.length > 0]); // only on first meaningful load

  // ── Warehouse markers (added click handler for calculation) ──────────────
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
      const popup = L.popup({ className: "light-popup", offset: [0, -4] }).setContent(
        popupHtml(w.name, w.code, w.address ?? ""),
      );
      const marker = L.marker([w.latitude, w.longitude], { icon })
        .bindPopup(popup);

      // Warehouse click: if a driver is selected for calculation, compute route
      marker.on("click", () => {
        if (selectedCalcDriver && selectedCalcDriver.current_lat && selectedCalcDriver.current_lon) {
          setCalcLoading(true);
          calculateRoute(
            { lat: selectedCalcDriver.current_lat, lon: selectedCalcDriver.current_lon },
            { lat: w.latitude, lon: w.longitude }
          )
            .then(({ distanceKm, minutes }) => {
              setCalcResult({ distanceKm, minutes });
            })
            .catch((err) => {
              console.error("Routing failed", err);
              setCalcResult(null);
              alert("Could not calculate route. Please try again.");
            })
            .finally(() => setCalcLoading(false));
        } else {
          // Optionally alert that no driver is selected
          if (selectedCalcDriver) alert("Driver location missing");
          else alert("Click a driver first to see distance/time to a warehouse");
        }
      });

      marker.addTo(layer);
    });
  }, [warehouses, selectedCalcDriver]);

  // ── Driver markers ───────────────────────────────────────────────────────
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
      const extra = activeJob ? `Job: <b>${activeJob.reference}</b>` : "";
      const lastSeen = d.last_update_time
        ? `GPS: ${new Date(d.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const popup = L.popup({ className: "light-popup", offset: [0, -8] }).setContent(
        popupHtml(d.name, d.status.replace(/_/g, " "), [extra, lastSeen].filter(Boolean).join(" · ")),
      );

      const marker = L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: isSelected ? 1000 : 0 })
        .bindPopup(popup);

      marker.on("click", () => {
        onSelectDriver?.(d.id);
        // Store driver for manual calculation and show coordinates
        setSelectedCalcDriver(d);
        setCalcResult(null); // clear previous result
      });

      marker.addTo(layer);
    });
  }, [drivers, selectedDriverId, onSelectDriver, jobs]);

  // ── Route line for selected driver (existing feature) ────────────────────
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

    L.polyline([from, to], { color: ROUTE_COLOR, weight: 8, opacity: 0.12, lineCap: "round" }).addTo(layer);
    L.polyline([from, to], { color: ROUTE_COLOR, weight: 4, opacity: 0.25, lineCap: "round" }).addTo(layer);
    L.polyline([from, to], {
      color: ROUTE_COLOR,
      weight: 2.8,
      opacity: 0.95,
      dashArray: "10 6",
      className: "route-line",
      lineCap: "round",
    }).addTo(layer);

    L.circleMarker(to, { radius: 8, fillColor: ROUTE_COLOR, fillOpacity: 0.9, color: BG, weight: 2.5 })
      .bindPopup(L.popup({ className: "light-popup" }).setContent(popupHtml(destWh.name, destWh.code)))
      .addTo(layer);

    L.circleMarker(to, { radius: 14, fillColor: "transparent", color: ROUTE_COLOR, weight: 1.8, opacity: 0.5 }).addTo(layer);

    mapRef.current?.flyToBounds(L.latLngBounds([from, to]), {
      padding: [100, 100],
      maxZoom: 10,
      duration: 1.1,
    });
  }, [selectedDriver, activeJob, warehouses]);

  // ── Helpers for distance/eta ──────────────────────────────────────────────
  async function calculateRoute(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number }
  ): Promise<{ distanceKm: number; minutes: number }> {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Routing service unavailable");
    const data = await res.json();
    if (!data.routes?.length) throw new Error("No route found");
    const { distance, duration } = data.routes[0];
    return { distanceKm: distance / 1000, minutes: Math.round(duration / 60) };
  }

  // ── Overlay for statistics + calculation panel ──────────────────────────
  const overlayStats = useMemo(() => {
    const onMap   = drivers.filter((d) => d.current_lat != null).length;
    const active  = drivers.filter((d) => ["AVAILABLE","ON_SHIFT","ON_ROUTE"].includes(d.status) && d.current_lat != null).length;
    const delayed = drivers.filter((d) => d.status === "DELAYED").length;
    const offline = drivers.filter((d) => d.current_lat == null).length;
    return { onMap, active, delayed, offline, total: drivers.length };
  }, [drivers]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Status overlay (bottom left, unchanged but background adapted) ── */}
      <div className="absolute bottom-6 left-3 z-[999] flex flex-col gap-2" style={{ pointerEvents: "none" }}>
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
          <span className="size-2 rounded-full bg-blue-500 shadow-sm" />
          <span className="text-xs font-semibold text-slate-700">{overlayStats.onMap}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">on map</span>
          {overlayStats.offline > 0 && (
            <span className="text-[10px] font-mono text-slate-400">· {overlayStats.offline} offline</span>
          )}
        </div>
        {overlayStats.active > 0 && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
            <span className="size-2 rounded-full bg-green-500 shadow-sm animate-pulse" />
            <span className="text-xs font-semibold text-slate-700">{overlayStats.active}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">active</span>
          </div>
        )}
        {overlayStats.delayed > 0 && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-amber-200 shadow-sm">
            <span className="size-2 rounded-full bg-amber-500 shadow-sm" />
            <span className="text-xs font-semibold text-slate-700">{overlayStats.delayed}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-600">delayed</span>
          </div>
        )}
      </div>

      {/* ── Calculation panel (bottom right) ──────────────────────────────── */}
      <div className="absolute bottom-6 right-3 z-[999] w-72" style={{ pointerEvents: "auto" }}>
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-xl p-3 text-sm font-sans">
          {selectedCalcDriver ? (
            <>
              <div className="flex justify-between items-start border-b border-slate-100 pb-2 mb-2">
                <div>
                  <span className="font-semibold text-slate-800">{selectedCalcDriver.name}</span>
                  <span className="text-xs text-slate-500 ml-2">📍 selected</span>
                </div>
                <button
                  onClick={() => {
                    setSelectedCalcDriver(null);
                    setCalcResult(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕ Clear
                </button>
              </div>
              <div className="space-y-1 text-xs">
                <div className="text-slate-500">
                  <span className="font-mono">Lat: {selectedCalcDriver.current_lat?.toFixed(5)}</span><br />
                  <span className="font-mono">Lon: {selectedCalcDriver.current_lon?.toFixed(5)}</span>
                </div>
                {calcLoading && (
                  <div className="text-blue-600 flex items-center gap-1 pt-1">
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-500 border-t-transparent" />
                    Calculating route...
                  </div>
                )}
                {calcResult && !calcLoading && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="text-slate-700 font-medium">→ distance / ETA</div>
                    <div className="font-mono text-slate-800">
                      {calcResult.distanceKm.toFixed(1)} km · {calcResult.minutes} min
                      {calcResult.minutes >= 60 && (
                        <span className="text-slate-500">
                          {" "}({Math.floor(calcResult.minutes / 60)}h {calcResult.minutes % 60}min)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Click a warehouse after selecting driver</p>
                  </div>
                )}
                {!calcLoading && !calcResult && (
                  <p className="text-[11px] text-slate-400 pt-1">Click any warehouse to get road distance & ETA</p>
                )}
              </div>
            </>
          ) : (
            <div className="text-slate-500 text-xs text-center py-1">
              Click a driver → click a warehouse → get distance & ETA
            </div>
          )}
        </div>
      </div>

      {/* ── Selected driver label (top center, background adjusted) ────────── */}
      {selectedDriver && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[999]" style={{ pointerEvents: "none" }}>
          <div className="flex items-center gap-2 rounded-full px-4 py-1.5 bg-white/90 backdrop-blur-md border border-slate-200 shadow-md">
            <span
              className="size-2 rounded-full shrink-0"
              style={{
                background: S_COLOR[selectedDriver.status]?.fill ?? "#3b82f6",
                boxShadow: `0 0 6px ${S_COLOR[selectedDriver.status]?.glow ?? "rgba(59,130,246,0.4)"}`,
              }}
            />
            <span className="text-sm font-semibold text-slate-800">{selectedDriver.name}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {selectedDriver.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
