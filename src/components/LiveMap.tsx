import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import type { Driver, Warehouse, Job } from "@/lib/types";

interface Props {
  drivers: Driver[];
  warehouses: Warehouse[];
  jobs: Job[];
  selectedDriverId?: string | null;
  onSelectDriver?: (id: string) => void;
}

// ── Status colour map (Modern palette) ───────────────────────────────────
const STATUS: Record<string, { bg: string; ring: string; text: string; label: string }> = {
  AVAILABLE: { bg: "#10b981", ring: "rgba(16,185,129,0.3)",  text: "#fff", label: "Available" },
  ON_SHIFT:  { bg: "#3b82f6", ring: "rgba(59,130,246,0.3)",  text: "#fff", label: "On shift"  },
  ON_ROUTE:  { bg: "#6366f1", ring: "rgba(99,102,241,0.3)",  text: "#fff", label: "On route"  },
  DELAYED:   { bg: "#ef4444", ring: "rgba(239,68,68,0.3)",   text: "#fff", label: "Delayed"   },
  OFF_SHIFT: { bg: "#94a3b8", ring: "rgba(148,163,184,0.2)", text: "#fff", label: "Off shift" },
  ON_BREAK:  { bg: "#f59e0b", ring: "rgba(245,158,11,0.3)",  text: "#fff", label: "On break"  },
};
const DEF_STATUS = STATUS.ON_SHIFT;
const ROUTE_COLOR = "#6366f1";

// ─────────────────────────────────────────────────────────────────────────────
// Marker HTML helpers
// ─────────────────────────────────────────────────────────────────────────────

function driverMarkerHtml(name: string, status: string, selected: boolean): string {
  const s = STATUS[status] ?? DEF_STATUS;
  const size = selected ? 36 : 28;
  const pulse = status !== "OFF_SHIFT" && !selected
    ? `<div class="marker-pulse" style="border-color: ${s.bg}"></div>`
    : "";
  
  return `
    <div class="modern-marker driver-marker ${selected ? 'selected' : ''}" style="--bg: ${s.bg}; --size: ${size}px">
      <div class="marker-content">
        ${(name[0]??"?").toUpperCase()}
      </div>
      ${pulse}
    </div>
  `;
}

function warehouseMarkerHtml(code: string, zoom: number): string {
  const showLabel = zoom > 9;
  return `
    <div class="modern-marker warehouse-marker ${showLabel ? 'with-label' : ''}">
      <div class="marker-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M3 21h18M3 7v14M21 7v14M2 3h20M10 21V11h4v10M7 7l5-4 5 4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      ${showLabel ? `<span class="marker-label">${code.toUpperCase()}</span>` : ""}
    </div>
  `;
}

function etaChipHtml(distKm: number, minutes: number): string {
  const t = minutes >= 60 ? `${Math.floor(minutes/60)}h ${minutes%60}m` : `${minutes} min`;
  return `
    <div class="eta-chip">
      <span class="dist">${distKm.toFixed(1)} km</span>
      <div class="divider"></div>
      <span class="time">${t}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel state types
// ─────────────────────────────────────────────────────────────────────────────

type Panel =
  | { kind: "idle" }
  | { kind: "driver"; driver: Driver; job?: Job }
  | { kind: "warehouse"; wh: Warehouse }
  | { kind: "eta"; driver: Driver; wh: Warehouse; distKm: number; minutes: number }
  | { kind: "loading"; driver: Driver; wh: Warehouse };

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const clusterLayer   = useRef<L.MarkerClusterGroup | null>(null);
  const routeLayer     = useRef<L.LayerGroup | null>(null);
  const etaMarkerRef   = useRef<L.Marker | null>(null);
  const routeMidRef    = useRef<[number,number] | null>(null);

  const [panel, setPanel]           = useState<Panel>({ kind: "idle" });
  const [pinnedDriver, setPinned]   = useState<Driver | null>(null);
  const [routeEta, setRouteEta]     = useState<{ distKm: number; minutes: number } | null>(null);
  const [zoom, setZoom]             = useState(7);

  // ── CSS for modern markers & clustering ───────────────────────────────────
  useEffect(() => {
    if (document.getElementById("lm-modern-css")) return;
    const el = document.createElement("style");
    el.id = "lm-modern-css";
    el.textContent = `
      .modern-marker {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .driver-marker {
        width: var(--size);
        height: var(--size);
        background: var(--bg);
        border-radius: 50%;
        color: white;
        font-weight: 700;
        font-size: calc(var(--size) * 0.4);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 0 0 2px white;
        cursor: pointer;
        z-index: 10;
      }
      .driver-marker.selected {
        box-shadow: 0 0 0 4px white, 0 0 0 6px var(--bg), 0 8px 24px rgba(0,0,0,0.25);
        z-index: 100;
      }
      .marker-pulse {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        border: 2px solid transparent;
        opacity: 0.6;
        animation: marker-pulse 2s ease-out infinite;
        pointer-events: none;
      }
      @keyframes marker-pulse {
        0% { transform: scale(1); opacity: 0.6; }
        100% { transform: scale(2.2); opacity: 0; }
      }
      .warehouse-marker {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 99px;
        padding: 4px;
        gap: 6px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        cursor: pointer;
      }
      .warehouse-marker .marker-icon {
        width: 24px;
        height: 24px;
        background: #ef4444;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }
      .warehouse-marker .marker-icon svg {
        width: 14px;
        height: 14px;
      }
      .warehouse-marker .marker-label {
        font-size: 12px;
        font-weight: 700;
        color: #1e293b;
        padding-right: 8px;
      }
      .eta-chip {
        background: #6366f1;
        color: white;
        padding: 6px 12px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.4);
        white-space: nowrap;
      }
      .eta-chip .divider {
        width: 1px;
        height: 12px;
        background: rgba(255,255,255,0.3);
      }
      /* Marker Cluster Overrides */
      .marker-cluster-small { background-color: rgba(181, 226, 191, 0.6); }
      .marker-cluster-small div { background-color: rgba(110, 204, 57, 0.6); }
      .marker-cluster-medium { background-color: rgba(241, 211, 87, 0.6); }
      .marker-cluster-medium div { background-color: rgba(240, 194, 12, 0.6); }
      .marker-cluster-large { background-color: rgba(253, 156, 115, 0.6); }
      .marker-cluster-large div { background-color: rgba(241, 128, 23, 0.6); }
      .marker-cluster div {
        width: 30px;
        height: 30px;
        margin-left: 5px;
        margin-top: 5px;
        text-align: center;
        border-radius: 15px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        color: #1e293b;
      }
      @keyframes route-flow {
        to { stroke-dashoffset: -20; }
      }
      .route-line-animated {
        animation: route-flow 1s linear infinite;
      }
      .leaflet-container {
        background: #f8fafc;
      }
    `;
    document.head.appendChild(el);
    return () => { document.getElementById("lm-modern-css")?.remove(); };
  }, []);

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [52.8, -1.8],
      zoom: 7,
      zoomControl: false,
      attributionControl: false,
    });
    // Modern "Positron" style tiles (cleaner than Google for fleet)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    clusterLayer.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 40,
    }).addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    map.on("zoomend", () => setZoom(map.getZoom()));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Fit to UK data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const pts: [number,number][] = [
      ...warehouses.map(w => [w.latitude, w.longitude] as [number,number]),
      ...drivers.filter(d => d.current_lat != null).map(d => [d.current_lat!, d.current_lon!] as [number,number]),
    ];
    if (!pts.length) return;
    mapRef.current.flyToBounds(L.latLngBounds(pts), { padding:[50,50], maxZoom:9, duration:1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.length > 0]);

  // ── Render Markers with Clustering ──────────────────────────────────────────
  useEffect(() => {
    const cluster = clusterLayer.current;
    if (!cluster) return;
    cluster.clearLayers();
    // Warehouses
    warehouses.forEach(w => {
      const icon = L.divIcon({
        className: "",
        html: warehouseMarkerHtml(w.code, zoom),
        iconAnchor: [16, 16],
      });
      L.marker([w.latitude, w.longitude], { icon })
        .on("click", () => {
          if (pinnedDriver?.current_lat != null) {
            setPanel({ kind: "loading", driver: pinnedDriver, wh: w });
            calcRoute(
              { lat: pinnedDriver.current_lat!, lon: pinnedDriver.current_lon! },
              { lat: w.latitude, lon: w.longitude }
            )
              .then(r => setPanel({ kind: "eta", driver: pinnedDriver, wh: w, ...r }))
              .catch(() => setPanel({ kind: "warehouse", wh: w }));
          } else {
            setPanel({ kind: "warehouse", wh: w });
          }
        })
        .addTo(cluster);
    });
    // Drivers
    drivers.forEach(d => {
      if (d.current_lat == null || d.current_lon == null) return;
      const sel = d.id === selectedDriverId;
      const icon = L.divIcon({
        className: "",
        html: driverMarkerHtml(d.name, d.status, sel),
        iconSize: [sel ? 36 : 28, sel ? 36 : 28],
        iconAnchor: [sel ? 18 : 14, sel ? 18 : 14],
      });
      const job = jobs.find(j =>
        j.assigned_driver_id === d.id &&
        ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
      );
      L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: sel ? 1000 : 0 })
        .on("click", () => {
          onSelectDriver?.(d.id);
          setPinned(d);
          setPanel({ kind: "driver", driver: d, job });
        })
        .addTo(cluster);
    });
  }, [drivers, warehouses, selectedDriverId, pinnedDriver, zoom, jobs]);

  // ── Route logic ────────────────────────────────────────────────────────────
  const selectedDriver = useMemo(() => drivers.find(d => d.id === selectedDriverId), [drivers, selectedDriverId]);
  const activeJob = useMemo(() =>
    jobs.find(j =>
      j.assigned_driver_id === selectedDriverId &&
      ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
    ), [jobs, selectedDriverId]);

  const destWh = useMemo(() => {
    if (!activeJob) return null;
    return warehouses.find(w =>
      ["ASSIGNED","IN_PROGRESS"].includes(activeJob.status)
        ? w.id === activeJob.origin_warehouse_id
        : w.id === activeJob.destination_warehouse_id
    ) ?? null;
  }, [activeJob, warehouses]);

  useEffect(() => {
    if (!selectedDriver?.current_lat || !destWh) { setRouteEta(null); return; }
    calcRoute(
      { lat: selectedDriver.current_lat!, lon: selectedDriver.current_lon! },
      { lat: destWh.latitude, lon: destWh.longitude }
    ).then(r => setRouteEta(r)).catch(() => setRouteEta(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriver?.id, activeJob?.id]);

  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer || !mapRef.current) return;
    layer.clearLayers();
    etaMarkerRef.current = null;
    routeMidRef.current  = null;
    if (!selectedDriver?.current_lat || !selectedDriver.current_lon) return;
    if (!destWh) {
      mapRef.current?.flyTo([selectedDriver.current_lat, selectedDriver.current_lon], 11, { duration:1.5 });
      return;
    }
    const from: [number,number] = [selectedDriver.current_lat, selectedDriver.current_lon];
    const to:   [number,number] = [destWh.latitude, destWh.longitude];
    routeMidRef.current = [(from[0]+to[0])/2, (from[1]+to[1])/2];
    // Fancy route line
    L.polyline([from,to], { color: ROUTE_COLOR, weight: 8, opacity: 0.1, lineCap: "round" }).addTo(layer);
    L.polyline([from,to], { color: ROUTE_COLOR, weight: 4, opacity: 0.8, lineCap: "round", dashArray: "1, 12", className: "route-line-animated" }).addTo(layer);
    // ETA Chip
    if (routeEta) {
      L.marker(routeMidRef.current, {
        icon: L.divIcon({ className:"", html: etaChipHtml(routeEta.distKm, routeEta.minutes), iconAnchor:[60,18] }),
        interactive: false,
      }).addTo(layer);
    }
    mapRef.current?.flyToBounds(L.latLngBounds([from,to]), { padding:[100,100], maxZoom:10, duration:1.5 });
  }, [selectedDriver, destWh, routeEta]);

  // ── OSRM helper ────────────────────────────────────────────────────────────
  async function calcRoute(
    from: { lat: number; lon: number },
    to:   { lat: number; lon: number }
  ): Promise<{ distKm: number; minutes: number }> {
    const res  = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`
    );
    if (!res.ok) throw new Error("routing unavailable");
    const data = await res.json();
    if (!data.routes?.length) throw new Error("no route");
    return { distKm: data.routes[0].distance/1000, minutes: Math.round(data.routes[0].duration/60) };
  }

  const stats = useMemo(() => ({
    total:   drivers.length,
    onMap:   drivers.filter(d => d.current_lat != null).length,
    active:  drivers.filter(d => ["AVAILABLE","ON_SHIFT","ON_ROUTE"].includes(d.status) && d.current_lat != null).length,
    delayed: drivers.filter(d => d.status === "DELAYED").length,
  }), [drivers]);

  const fmtTime = (m: number) => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m} min`;

  function PanelContent() {
    switch (panel.kind) {
      case "idle": return (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="size-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
            </svg>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed px-4">
            Select a driver to view their route, or click a warehouse to see details.
          </p>
        </div>
      );
      case "driver": {
        const { driver, job } = panel;
        const s = STATUS[driver.status] ?? DEF_STATUS;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl flex items-center justify-center font-bold text-white shadow-lg"
                style={{ background: s.bg }}>
                {(driver.name[0]??"?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{driver.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="size-2 rounded-full animate-pulse" style={{ background: s.bg }} />
                  <span className="text-[11px] font-medium text-slate-500">{s.label}</span>
                </div>
              </div>
            </div>
            {job && (
              <div className="rounded-xl p-3 bg-indigo-50/50 border border-indigo-100">
                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Active Assignment</div>
                <div className="text-xs font-bold text-indigo-900">{job.reference}</div>
                <div className="text-[11px] text-indigo-600 mt-0.5">{job.status.replace(/_/g," ")}</div>
              </div>
            )}
            <p className="text-[11px] text-slate-400 italic">
              Click a warehouse to calculate distance & ETA from this driver.
            </p>
          </div>
        );
      }
      case "warehouse": {
        const { wh } = panel;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 border border-red-100">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M3 7v14M21 7v14M2 3h20M10 21V11h4v10M7 7l5-4 5 4"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{wh.code}</div>
                <div className="text-[11px] text-slate-500 truncate">{wh.name}</div>
              </div>
              <button onClick={() => setPanel({ kind:"idle" })} className="text-slate-300 hover:text-slate-500 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {wh.address && <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">{wh.address}</div>}
          </div>
        );
      }
      case "loading": return (
        <div className="py-4 flex flex-col items-center gap-3">
          <div className="size-8 rounded-full border-2 border-indigo-100 border-t-indigo-500 animate-spin" />
          <span className="text-xs font-medium text-slate-500">Optimizing route…</span>
        </div>
      );
      case "eta": {
        const { driver, wh, distKm, minutes } = panel;
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
               <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Route Analysis</div>
               <button onClick={() => setPanel({ kind:"driver", driver })} className="text-[10px] font-bold text-indigo-500 hover:underline">Back</button>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900 text-white shadow-xl">
              <div className="flex-1 text-center">
                <div className="text-xl font-black">{distKm.toFixed(1)}</div>
                <div className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Kilometers</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex-1 text-center">
                <div className="text-xl font-black">{fmtTime(minutes)}</div>
                <div className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Estimated Time</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              <span className="text-slate-900 font-bold">{driver.name}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <span className="text-red-500 font-bold">{wh.code}</span>
            </div>
          </div>
        );
      }
    }
  }

  return (
    <div className="absolute inset-0 bg-slate-50 font-sans">
      <div ref={containerRef} className="absolute inset-0" />
      {/* ── Header Status ───────────────────────────────────────────── */}
      {selectedDriver && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999]">
          <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md border border-slate-200 px-4 py-2 rounded-2xl shadow-2xl">
            <div className="size-2 rounded-full animate-pulse" style={{ background: STATUS[selectedDriver.status]?.bg ?? ROUTE_COLOR }} />
            <span className="text-xs font-bold text-slate-900">{selectedDriver.name}</span>
            <div className="w-px h-3 bg-slate-200" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {selectedDriver.status.replace(/_/g," ")}
            </span>
          </div>
        </div>
      )}
      {/* ── Stats ────────────────────────────────────────────────────── */}
      <div className="absolute bottom-6 left-6 z-[998] flex flex-col gap-2">
        <StatPill color="#3b82f6" count={stats.onMap} label="Connected" />
        {stats.active > 0 && <StatPill color="#10b981" count={stats.active} label="Active" pulse />}
        {stats.delayed > 0 && <StatPill color="#ef4444" count={stats.delayed} label="Delayed" />}
      </div>
      {/* ── Panel ────────────────────────────────────────────────────── */}
      <div className="absolute bottom-6 right-6 z-[998] w-72">
        <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-3xl p-5 shadow-2xl">
          <PanelContent />
        </div>
      </div>
    </div>
  );
}

function StatPill({ color, count, label, pulse }: { color: string; count: number; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur-sm border border-slate-200 px-3 py-1.5 rounded-xl shadow-sm">
      <div className={`size-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color }} />
      <span className="text-xs font-bold text-slate-900">{count}</span>
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}
