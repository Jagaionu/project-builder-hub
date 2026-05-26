import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
// @ts-ignore
import "leaflet.markercluster";
import type { Driver, Warehouse, Job } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────────────
interface Props {
  drivers: Driver[];
  warehouses: Warehouse[];
  jobs: Job[];
  selectedDriverId?: string | null;
  onSelectDriver?: (id: string) => void;
}

type RouteEta = { distKm: number; minutes: number };
type Panel =
  | { kind: "idle" }
  | { kind: "driver"; driver: Driver; job?: Job }
  | { kind: "warehouse"; wh: Warehouse; nearbyDrivers: Driver[] }
  | { kind: "eta"; driver: Driver; wh: Warehouse; distKm: number; minutes: number }
  | { kind: "loading"; driver: Driver; wh: Warehouse };

// ─── Status colour map ─────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { bg: string; glow: string; label: string }> = {
  AVAILABLE: { bg: "#16a34a", glow: "rgba(22,163,74,0.35)",   label: "Available"  },
  ON_SHIFT:  { bg: "#2563eb", glow: "rgba(37,99,235,0.35)",   label: "On Shift"   },
  ON_ROUTE:  { bg: "#7c3aed", glow: "rgba(124,58,237,0.35)",  label: "On Route"   },
  DELAYED:   { bg: "#dc2626", glow: "rgba(220,38,38,0.35)",   label: "Delayed"    },
  OFF_SHIFT: { bg: "#94a3b8", glow: "rgba(148,163,184,0.2)",  label: "Off Shift"  },
  ON_BREAK:  { bg: "#d97706", glow: "rgba(217,119,6,0.35)",   label: "On Break"   },
};
const DEF_STATUS = STATUS_MAP.ON_SHIFT;

// ─── Marker HTML ───────────────────────────────────────────────────────────
function driverHtml(name: string, status: string, selected: boolean): string {
  const s = STATUS_MAP[status] ?? DEF_STATUS;
  const sz = selected ? 42 : 32;
  const ring = selected
    ? `box-shadow:0 0 0 3px #fff,0 0 0 5px ${s.bg},0 6px 20px ${s.glow}`
    : `box-shadow:0 0 0 2px #fff,0 3px 10px rgba(0,0,0,0.2)`;
  const pulse = status !== "OFF_SHIFT" && !selected
    ? `<span class="drv-pulse" style="border-color:${s.bg}"></span>` : "";
  return `
<div class="drv-mk" style="width:${sz}px;height:${sz}px;background:${s.bg};${ring}">
  <span class="drv-init" style="font-size:${sz * 0.38}px">${(name[0] ?? "?").toUpperCase()}</span>
  ${pulse}
</div>`;
}

function warehouseHtml(code: string): string {
  return `
<div class="wh-mk">
  <div class="wh-body">
    <svg class="wh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 22V9l10-7 10 7v13H2z"/>
      <path d="M9 22v-8h6v8"/>
      <path d="M2 9h20"/>
    </svg>
    <span class="wh-code">${code}</span>
  </div>
  <div class="wh-pin"></div>
</div>`;
}

function etaHtml(distKm: number, minutes: number): string {
  const t = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `
<div class="eta-chip">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 3"/></svg>
  <span>${distKm.toFixed(1)} km</span>
  <span class="eta-sep">·</span>
  <span>${t}</span>
</div>`;
}

// ─── CSS injection ─────────────────────────────────────────────────────────
const MAP_CSS = `
.drv-mk{border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer;transition:transform .15s,box-shadow .15s}
.drv-mk:hover{transform:scale(1.12)}
.drv-init{color:#fff;font-weight:800;font-family:system-ui,sans-serif;line-height:1;pointer-events:none}
.drv-pulse{position:absolute;inset:-6px;border-radius:50%;border:2px solid;opacity:0;animation:drv-ring 2.4s ease-out infinite}
@keyframes drv-ring{0%{opacity:.7;transform:scale(.9)}100%{opacity:0;transform:scale(2)}}

.wh-mk{display:flex;flex-direction:column;align-items:center;cursor:pointer}
.wh-body{background:#f97316;border:2px solid #fff;border-radius:8px;width:40px;height:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;box-shadow:0 4px 14px rgba(249,115,22,.38),0 2px 5px rgba(0,0,0,.14);transition:transform .2s,box-shadow .2s}
.wh-mk:hover .wh-body{transform:scale(1.1);box-shadow:0 6px 20px rgba(249,115,22,.52),0 2px 7px rgba(0,0,0,.17)}
.wh-icon{width:17px;height:17px;color:#fff;flex-shrink:0}
.wh-code{color:#000;font-size:9px;font-weight:900;font-family:system-ui,sans-serif;letter-spacing:.05em;line-height:1}
.wh-pin{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #f97316;margin-top:-1px}

.eta-chip{background:#1e293b;color:#f8fafc;border-radius:20px;padding:5px 12px;display:flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;font-family:system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);white-space:nowrap}
.eta-chip svg{opacity:.7;flex-shrink:0}
.eta-sep{opacity:.4}

.marker-cluster-small,.marker-cluster-medium,.marker-cluster-large{border-radius:50%!important}
.marker-cluster-small{background:rgba(37,99,235,.15)!important;border:2px solid rgba(37,99,235,.4)!important}
.marker-cluster-small div{background:#2563eb!important;color:#fff!important;font-weight:800!important}
.marker-cluster-medium{background:rgba(124,58,237,.15)!important;border:2px solid rgba(124,58,237,.4)!important}
.marker-cluster-medium div{background:#7c3aed!important;color:#fff!important;font-weight:800!important}
.marker-cluster-large{background:rgba(220,38,38,.15)!important;border:2px solid rgba(220,38,38,.4)!important}
.marker-cluster-large div{background:#dc2626!important;color:#fff!important;font-weight:800!important}
.marker-cluster div{width:34px!important;height:34px!important;margin:2px!important;border-radius:50%!important;line-height:34px!important;font-size:12px!important;display:flex!important;align-items:center!important;justify-content:center!important}
.wh-cluster-small{background:rgba(249,115,22,.15)!important;border:2px solid rgba(249,115,22,.45)!important}
.wh-cluster-small div{background:#f97316!important;color:#fff!important;font-weight:900!important}
.wh-cluster-medium{background:rgba(234,88,12,.15)!important;border:2px solid rgba(234,88,12,.45)!important}
.wh-cluster-medium div{background:#ea580c!important;color:#fff!important;font-weight:900!important}
.wh-cluster-large{background:rgba(194,65,12,.15)!important;border:2px solid rgba(194,65,12,.45)!important}
.wh-cluster-large div{background:#c2410c!important;color:#fff!important;font-weight:900!important}

@keyframes route-dash{to{stroke-dashoffset:-24}}
.route-anim{animation:route-dash 1.1s linear infinite}

.leaflet-container{font-family:system-ui,sans-serif!important}
`;

// ─── OSRM real-road routing ────────────────────────────────────────────────
async function fetchRoute(
  from: { lat: number; lon: number },
  to:   { lat: number; lon: number }
): Promise<{ coords: [number, number][]; distKm: number; minutes: number }> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("routing unavailable");
  const data = await res.json();
  if (!data.routes?.length) throw new Error("no route");
  const r = data.routes[0];
  // GeoJSON coords are [lon, lat], flip to [lat, lon] for Leaflet
  const coords: [number, number][] = r.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon]
  );
  return {
    coords,
    distKm: r.distance / 1000,
    minutes: Math.round(r.duration / 60),
  };
}

// ─── Component ─────────────────────────────────────────────────────────────
export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef       = useRef<HTMLDivElement | null>(null);
  const mapRef             = useRef<L.Map | null>(null);
  const clusterLayerRef    = useRef<any | null>(null);
  const whClusterLayerRef  = useRef<any | null>(null);
  const routeLayerRef      = useRef<L.LayerGroup | null>(null);

  const [panel, setPanel]       = useState<Panel>({ kind: "idle" });
  const [routeEta, setRouteEta] = useState<RouteEta | null>(null);
  const [isRouting, setIsRouting] = useState(false);

  // ── CSS ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("lm-css")) return;
    const el = document.createElement("style");
    el.id = "lm-css";
    el.textContent = MAP_CSS;
    document.head.appendChild(el);
    return () => document.getElementById("lm-css")?.remove();
  }, []);

  // ── Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [52.8, -1.8],
      zoom: 7,
      zoomControl: false,
      attributionControl: false,
    });

    // Voyager — closest to Google Maps: coloured roads, POI labels, full detail
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { maxZoom: 20, attribution: "" }
    ).addTo(map);

    L.control.attribution({ position: "bottomleft", prefix: "© CartoDB © OpenStreetMap" }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);

    clusterLayerRef.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 13,
      zoomToBoundsOnClick: true,
    }).addTo(map);

    // Warehouse cluster — orange-themed, separate from driver cluster
    whClusterLayerRef.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
      disableClusteringAtZoom: 12,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const sz    = count < 5 ? "small" : count < 15 ? "medium" : "large";
        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster wh-cluster-${sz}`,
          iconSize: L.point(40, 40),
        });
      },
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Fit bounds to data ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const pts: L.LatLngExpression[] = [
      ...warehouses.map(w => [w.latitude, w.longitude] as [number, number]),
      ...drivers.filter(d => d.current_lat != null).map(d => [d.current_lat!, d.current_lon!] as [number, number]),
    ];
    if (!pts.length) return;
    mapRef.current.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 9, duration: 1.4 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.length > 0]);

  // ── Warehouse markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const layer = whClusterLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    warehouses.forEach(wh => {
      const nearbyDrivers = drivers
        .filter(d => {
          if (d.current_lat == null) return false;
          const dx = d.current_lat - wh.latitude;
          const dy = d.current_lon! - wh.longitude;
          return Math.sqrt(dx * dx + dy * dy) < 0.08;
        })
        .sort((a, b) => {
          const da = Math.sqrt((a.current_lat! - wh.latitude) ** 2 + (a.current_lon! - wh.longitude) ** 2);
          const db = Math.sqrt((b.current_lat! - wh.latitude) ** 2 + (b.current_lon! - wh.longitude) ** 2);
          return da - db;
        });

      const icon = L.divIcon({
        className: "",
        html: warehouseHtml(wh.code),
        iconSize:   [40, 52],
        iconAnchor: [20, 52],
        popupAnchor:[0, -54],
      });

      L.marker([wh.latitude, wh.longitude], { icon, zIndexOffset: 2000 })
        .on("click", () => {
          setPanel({ kind: "warehouse", wh, nearbyDrivers });
          mapRef.current?.flyTo([wh.latitude, wh.longitude], 13, { duration: 1.2 });
        })
        .addTo(layer);
    });
  }, [drivers, warehouses]);

  // ── Driver markers ────────────────────────────────────────────────────────
  useEffect(() => {
    const cluster = clusterLayerRef.current;
    if (!cluster) return;
    cluster.clearLayers();

    drivers.forEach(d => {
      if (d.current_lat == null || d.current_lon == null) return;
      const sel = d.id === selectedDriverId;
      const sz  = sel ? 42 : 32;
      const icon = L.divIcon({
        className: "",
        html: driverHtml(d.name, d.status, sel),
        iconSize:   [sz, sz],
        iconAnchor: [sz / 2, sz / 2],
      });
      const job = jobs.find(j =>
        j.assigned_driver_id === d.id &&
        ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status)
      );
      L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: sel ? 2000 : 0 })
        .on("click", () => {
          onSelectDriver?.(d.id);
          setPanel({ kind: "driver", driver: d, job });
        })
        .addTo(cluster);
    });
  }, [drivers, selectedDriverId, jobs, onSelectDriver]);

  // ── Active job / destination warehouse ───────────────────────────────────
  const selectedDriver = useMemo(
    () => drivers.find(d => d.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId]
  );

  const activeJob = useMemo(
    () =>
      jobs.find(
        j =>
          j.assigned_driver_id === selectedDriverId &&
          ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status)
      ) ?? null,
    [jobs, selectedDriverId]
  );

  const destWh = useMemo(() => {
    if (!activeJob) return null;
    const pickupPhase = ["ASSIGNED", "IN_PROGRESS"].includes(activeJob.status);
    return (
      warehouses.find(w =>
        pickupPhase
          ? w.id === activeJob.origin_warehouse_id
          : w.id === activeJob.destination_warehouse_id
      ) ?? null
    );
  }, [activeJob, warehouses]);

  // ── Draw route (real road geometry) ──────────────────────────────────────
  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer || !mapRef.current) return;
    layer.clearLayers();
    setRouteEta(null);

    if (!selectedDriver?.current_lat || !selectedDriver.current_lon) return;

    if (!destWh) {
      mapRef.current.flyTo(
        [selectedDriver.current_lat, selectedDriver.current_lon], 12, { duration: 1.4 }
      );
      return;
    }

    setIsRouting(true);

    fetchRoute(
      { lat: selectedDriver.current_lat, lon: selectedDriver.current_lon },
      { lat: destWh.latitude, lon: destWh.longitude }
    )
      .then(({ coords, distKm, minutes }) => {
        layer.clearLayers();

        const s = STATUS_MAP[selectedDriver.status] ?? DEF_STATUS;
        const isDelayed = selectedDriver.status === "DELAYED";
        const lineColor = isDelayed ? "#dc2626" : s.bg;

        // Glow / halo underlay
        L.polyline(coords, {
          color: lineColor,
          weight: 14,
          opacity: 0.12,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layer);

        // White border (road feel)
        L.polyline(coords, {
          color: "#fff",
          weight: 7,
          opacity: 0.7,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layer);

        // Main coloured route
        L.polyline(coords, {
          color: lineColor,
          weight: 5,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layer);

        // Animated dashes overlay
        L.polyline(coords, {
          color: "#fff",
          weight: 2,
          opacity: 0.9,
          lineCap: "round",
          dashArray: "1 16",
          className: "route-anim",
        }).addTo(layer);

        // ETA chip at midpoint
        const mid = coords[Math.floor(coords.length / 2)];
        L.marker(mid, {
          icon: L.divIcon({
            className: "",
            html: etaHtml(distKm, minutes),
            iconAnchor: [80, 16],
          }),
          interactive: false,
          zIndexOffset: 3000,
        }).addTo(layer);

        // Origin dot
        L.circleMarker([selectedDriver.current_lat!, selectedDriver.current_lon!], {
          radius: 7, color: "#fff", weight: 2, fillColor: lineColor, fillOpacity: 1,
        }).addTo(layer);

        // Destination dot
        L.circleMarker([destWh.latitude, destWh.longitude], {
          radius: 8, color: "#fff", weight: 2.5, fillColor: lineColor, fillOpacity: 1,
        }).addTo(layer);

        setRouteEta({ distKm, minutes });
        setIsRouting(false);

        mapRef.current?.flyToBounds(
          L.latLngBounds(coords),
          { padding: [90, 90], maxZoom: 11, duration: 1.6 }
        );
      })
      .catch(() => {
        // Fallback: straight dashed line
        const from: [number, number] = [selectedDriver.current_lat!, selectedDriver.current_lon!];
        const to:   [number, number] = [destWh.latitude, destWh.longitude];
        L.polyline([from, to], {
          color: "#7c3aed", weight: 3, opacity: 0.7, dashArray: "8 8",
        }).addTo(layer);
        setIsRouting(false);
        mapRef.current?.flyToBounds(L.latLngBounds([from, to]), { padding: [80, 80], maxZoom: 11 });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriverId, activeJob?.id, destWh?.id]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   drivers.length,
    onMap:   drivers.filter(d => d.current_lat != null).length,
    active:  drivers.filter(d =>
      ["AVAILABLE", "ON_SHIFT", "ON_ROUTE"].includes(d.status) && d.current_lat != null
    ).length,
    onRoute: drivers.filter(d => d.status === "ON_ROUTE").length,
    delayed: drivers.filter(d => d.status === "DELAYED").length,
  }), [drivers]);

  const fmtTime = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;

  // ── Panel sub-components ──────────────────────────────────────────────────
  function PanelIdle() {
    return (
      <div className="flex flex-col items-center gap-3 py-6 px-2 text-center">
        <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
            <circle cx="12" cy="10" r="2.5"/>
          </svg>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed max-w-[180px]">
          Click a driver to view their route, or a warehouse to see nearby drivers.
        </p>
      </div>
    );
  }

  function PanelDriver({ driver, job }: { driver: Driver; job?: Job }) {
    const s = STATUS_MAP[driver.status] ?? DEF_STATUS;
    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm shadow-md flex-shrink-0"
            style={{ background: s.bg }}
          >
            {(driver.name[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate leading-tight">{driver.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.bg }} />
              <span className="text-[11px] font-semibold text-slate-500">{s.label}</span>
            </div>
          </div>
          <button
            onClick={() => { setPanel({ kind: "idle" }); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Active job */}
        {job && (
          <div className="rounded-xl p-3 border border-violet-100 bg-violet-50">
            <p className="text-[10px] font-black text-violet-400 uppercase tracking-widest mb-1">Active Job</p>
            <p className="text-xs font-bold text-violet-900 truncate">{job.reference}</p>
            <p className="text-[11px] text-violet-500 mt-0.5">{job.status.replaceAll("_", " ")}</p>
          </div>
        )}

        {/* Route ETA if available */}
        {routeEta && destWh && (
          <div className="rounded-lg px-3 py-2 bg-slate-900 text-white flex items-center gap-0">
            <div className="flex-1 text-center">
              <p className="text-base font-black leading-none">{routeEta.distKm.toFixed(1)}</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">km · {destWh.code}</p>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div className="flex-1 text-center">
              <p className="text-base font-black leading-none">{fmtTime(routeEta.minutes)}</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">ETA</p>
            </div>
          </div>
        )}

        {isRouting && (
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-violet-500 animate-spin flex-shrink-0" />
            <p className="text-[11px] text-slate-400 font-medium">Calculating road route…</p>
          </div>
        )}

        {!job && !isRouting && (
          <p className="text-[11px] text-slate-400 italic px-0.5">No active assignment.</p>
        )}
      </div>
    );
  }

  function PanelWarehouse({ wh, nearbyDrivers }: { wh: Warehouse; nearbyDrivers: Driver[] }) {
    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 22V9l10-7 10 7v13H2z"/>
              <path d="M9 22v-8h6v8"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate leading-tight">{wh.code}</p>
            {wh.name && <p className="text-[11px] text-slate-500 truncate mt-0.5">{wh.name}</p>}
          </div>
          <button
            onClick={() => setPanel({ kind: "idle" })}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {wh.address && (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 leading-relaxed">
            {wh.address}
          </p>
        )}

        {/* Nearby drivers */}
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Nearby Drivers ({nearbyDrivers.length})
          </p>
          {nearbyDrivers.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic text-center py-3">No drivers in proximity</p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
              {nearbyDrivers.map(d => {
                const s = STATUS_MAP[d.status] ?? DEF_STATUS;
                return (
                  <button
                    key={d.id}
                    onClick={() => {
                      onSelectDriver?.(d.id);
                      const job = jobs.find(j =>
                        j.assigned_driver_id === d.id &&
                        ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
                      );
                      setPanel({ kind: "driver", driver: d, job });
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all text-left group"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-xs flex-shrink-0"
                      style={{ background: s.bg }}
                    >
                      {(d.name[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate leading-tight">{d.name}</p>
                      <p className="text-[10px] text-slate-400">{s.label}</p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderPanel() {
    switch (panel.kind) {
      case "idle":      return <PanelIdle />;
      case "driver":    return <PanelDriver driver={panel.driver} job={panel.job} />;
      case "warehouse": return <PanelWarehouse wh={panel.wh} nearbyDrivers={panel.nearbyDrivers} />;
      case "loading":   return (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-8 h-8 rounded-full border-2 border-slate-100 border-t-violet-500 animate-spin" />
          <p className="text-xs text-slate-400 font-medium">Calculating route…</p>
        </div>
      );
      default: return null;
    }
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Top pill: selected driver status ────────────────────────────── */}
      {selectedDriver && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-none">
          <div className="flex items-center gap-2.5 bg-white/95 backdrop-blur border border-slate-200/80 px-4 py-2 rounded-2xl shadow-xl">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: STATUS_MAP[selectedDriver.status]?.bg ?? ROUTE_COLOR }}
            />
            <span className="text-xs font-bold text-slate-900">{selectedDriver.name}</span>
            <span className="w-px h-3 bg-slate-200 inline-block" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {selectedDriver.status.replaceAll("_", " ")}
            </span>
            {isRouting && (
              <>
                <span className="w-px h-3 bg-slate-200 inline-block" />
                <span className="w-3 h-3 rounded-full border-2 border-slate-200 border-t-violet-500 animate-spin inline-block" />
                <span className="text-[10px] text-slate-400 font-semibold">routing…</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom-left: stat pills ─────────────────────────────────────── */}
      <div className="absolute bottom-6 left-5 z-[998] flex flex-col gap-1.5">
        <StatPill color="#2563eb" count={stats.onMap}   label="Connected" />
        {stats.active  > 0 && <StatPill color="#16a34a" count={stats.active}  label="Active"    pulse />}
        {stats.onRoute > 0 && <StatPill color="#7c3aed" count={stats.onRoute} label="On Route"  />}
        {stats.delayed > 0 && <StatPill color="#dc2626" count={stats.delayed} label="Delayed"   />}
      </div>

      {/* ── Bottom-right: info panel ────────────────────────────────────── */}
      <div className="absolute bottom-6 right-5 z-[998] w-72">
        <div className="bg-white/97 backdrop-blur-md border border-slate-200 rounded-2xl p-4 shadow-2xl">
          {renderPanel()}
        </div>
      </div>

      {/* ── Top-right: legend ──────────────────────────────────────────── */}
      <div className="absolute top-4 right-14 z-[998]">
        <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl px-3 py-2 shadow-lg">
          <div className="flex flex-col gap-1.5">
            {Object.entries(STATUS_MAP).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: val.bg }} />
                <span className="text-[10px] font-semibold text-slate-500">{val.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat pill ────────────────────────────────────────────────────────────────
const ROUTE_COLOR = "#7c3aed";

function StatPill({
  color, count, label, pulse,
}: {
  color: string; count: number; label: string; pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 bg-white/95 backdrop-blur border border-slate-200 px-3 py-1.5 rounded-xl shadow-sm">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${pulse ? "animate-pulse" : ""}`}
        style={{ background: color }}
      />
      <span className="text-xs font-black text-slate-800">{count}</span>
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}
