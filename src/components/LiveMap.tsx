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

// ── Status colour map (Google Maps palette) ───────────────────────────────────
const STATUS: Record<string, { bg: string; ring: string; text: string; label: string }> = {
  AVAILABLE: { bg: "#34a853", ring: "rgba(52,168,83,0.35)",  text: "#fff", label: "Available" },
  ON_SHIFT:  { bg: "#1a73e8", ring: "rgba(26,115,232,0.35)", text: "#fff", label: "On shift"  },
  ON_ROUTE:  { bg: "#1a73e8", ring: "rgba(26,115,232,0.35)", text: "#fff", label: "On route"  },
  DELAYED:   { bg: "#ea4335", ring: "rgba(234,67,53,0.35)",  text: "#fff", label: "Delayed"   },
  OFF_SHIFT: { bg: "#bdc1c6", ring: "rgba(189,193,198,0.2)", text: "#fff", label: "Off shift" },
  ON_BREAK:  { bg: "#fa7b17", ring: "rgba(250,123,23,0.35)", text: "#fff", label: "On break"  },
};
const DEF_STATUS = STATUS.ON_SHIFT;
const ROUTE_BLUE = "#1a73e8";

// ─────────────────────────────────────────────────────────────────────────────
// Marker HTML helpers
// ─────────────────────────────────────────────────────────────────────────────

function driverDot(name: string, status: string, selected: boolean): string {
  const s = STATUS[status] ?? DEF_STATUS;
  const size = selected ? 30 : 22;
  const fs   = selected ? 11 : 9;
  // ring for active statuses
  const pulse = status !== "OFF_SHIFT" && !selected
    ? `<div style="position:absolute;inset:-7px;border-radius:50%;border:1.5px solid ${s.bg};opacity:.5;animation:dpulse 2s ease-out infinite;pointer-events:none"></div>`
    : "";
  const shadow = selected
    ? `0 0 0 2.5px #fff, 0 0 0 4.5px ${s.bg}, 0 4px 14px rgba(0,0,0,.22)`
    : `0 0 0 2px #fff, 0 0 0 3.5px ${s.bg}, 0 2px 6px rgba(0,0,0,.18)`;
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${s.bg};box-shadow:${shadow};
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    font-weight:700;font-size:${fs}px;color:#fff;
    cursor:pointer;position:relative;
    ${selected ? "z-index:900;" : ""}
  ">${(name[0]??"?").toUpperCase()}${pulse}</div>`;
}

function whPin(code: string): string {
  // Minimal pill: small red-dot anchor + bold code text
  return `<div style="
    display:flex;align-items:center;gap:5px;
    background:#fff;border:1.5px solid #dadce0;border-radius:20px;
    padding:4px 10px 4px 6px;
    box-shadow:0 1px 5px rgba(0,0,0,.16),0 1px 2px rgba(0,0,0,.08);
    cursor:pointer;white-space:nowrap;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  ">
    <div style="width:18px;height:18px;border-radius:50%;background:#ea4335;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
    </div>
    <span style="font-size:11.5px;font-weight:700;color:#202124;letter-spacing:.04em">${code.toUpperCase()}</span>
  </div>`;
}

function etaChip(distKm: number, minutes: number): string {
  const t = minutes >= 60 ? `${Math.floor(minutes/60)}h ${minutes%60}m` : `${minutes} min`;
  return `<div style="
    background:#1a73e8;border-radius:16px;padding:5px 12px;
    display:flex;align-items:center;gap:8px;
    box-shadow:0 2px 12px rgba(26,115,232,.4);
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    white-space:nowrap;pointer-events:none;
  ">
    <span style="font-size:12px;font-weight:700;color:#fff">${distKm.toFixed(1)} km</span>
    <div style="width:1px;height:12px;background:rgba(255,255,255,.35)"></div>
    <span style="font-size:12px;font-weight:500;color:rgba(255,255,255,.9)">${t}</span>
  </div>`;
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
  const driverLayer    = useRef<L.LayerGroup | null>(null);
  const warehouseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer     = useRef<L.LayerGroup | null>(null);
  const etaMarkerRef   = useRef<L.Marker | null>(null);
  const routeMidRef    = useRef<[number,number] | null>(null);

  const [panel, setPanel]           = useState<Panel>({ kind: "idle" });
  const [pinnedDriver, setPinned]   = useState<Driver | null>(null);
  const [routeEta, setRouteEta]     = useState<{ distKm: number; minutes: number } | null>(null);

  // ── CSS animations (once) ──────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("lm-css")) return;
    const el = document.createElement("style");
    el.id = "lm-css";
    el.textContent = `
      @keyframes dpulse { 0%{transform:scale(1);opacity:.5} 75%{transform:scale(2.8);opacity:0} 100%{transform:scale(2.8);opacity:0} }
      @keyframes rflow  { to { stroke-dashoffset: -22; } }
      .rm path { animation: rflow .85s linear infinite; }
      .leaflet-control-zoom { border:none!important; }
      .leaflet-control-zoom a {
        background:#fff!important;color:#202124!important;
        width:32px!important;height:32px!important;line-height:32px!important;
        border:1.5px solid #dadce0!important;border-radius:8px!important;
        margin-bottom:4px!important;display:block!important;
        font-size:18px!important;font-weight:400!important;
        box-shadow:0 1px 4px rgba(0,0,0,.12)!important;
        transition:background .15s!important;
      }
      .leaflet-control-zoom a:hover { background:#f1f3f4!important; }
      .leaflet-control-zoom-in  { border-radius:8px!important; }
      .leaflet-control-zoom-out { border-radius:8px!important; }
      .leaflet-attribution-flag { display:none!important; }
    `;
    document.head.appendChild(el);
    return () => { document.getElementById("lm-css")?.remove(); };
  }, []);

  // ── Init map (UK-centred, Google Maps tiles) ───────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [52.8, -1.8],   // UK centre
      zoom: 7,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      subdomains: ["mt0","mt1","mt2","mt3"],
      maxZoom: 20,
      attribution: "© Google Maps",
    }).addTo(map);

    // Zoom top-right — well away from the bottom-right panel
    L.control.zoom({ position: "topright" }).addTo(map);

    warehouseLayer.current = L.layerGroup().addTo(map);
    routeLayer.current     = L.layerGroup().addTo(map);
    driverLayer.current    = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Fit to UK data on first load ───────────────────────────────────────────
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

  // ── Warehouse markers (no popup — panel only) ──────────────────────────────
  useEffect(() => {
    const layer = warehouseLayer.current;
    if (!layer) return;
    layer.clearLayers();
    warehouses.forEach(w => {
      const icon = L.divIcon({
        className: "",
        html: whPin(w.code),
        // anchor so red circle sits on the coordinate
        iconAnchor: [14, 18],
      });
      L.marker([w.latitude, w.longitude], { icon })
        .on("click", () => {
          if (pinnedDriver?.current_lat != null) {
            // calc mode
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
        .addTo(layer);
    });
  }, [warehouses, pinnedDriver]);

  // ── Driver markers (no popup — panel only) ────────────────────────────────
  useEffect(() => {
    const layer = driverLayer.current;
    if (!layer) return;
    layer.clearLayers();
    drivers.forEach(d => {
      if (d.current_lat == null || d.current_lon == null) return;
      const sel = d.id === selectedDriverId;
      const sz  = sel ? 30 : 22;
      const icon = L.divIcon({
        className: "",
        html: driverDot(d.name, d.status, sel),
        iconSize:   [sz, sz],
        iconAnchor: [sz/2, sz/2],
      });
      const job = jobs.find(j =>
        j.assigned_driver_id === d.id &&
        ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
      );
      L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: sel ? 900 : 0 })
        .on("click", () => {
          onSelectDriver?.(d.id);
          setPinned(d);
          setPanel({ kind: "driver", driver: d, job });
        })
        .addTo(layer);
    });
  }, [drivers, selectedDriverId, onSelectDriver, jobs]);

  // ── Derived ────────────────────────────────────────────────────────────────
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

  // ── Auto ETA for active route ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDriver?.current_lat || !destWh) { setRouteEta(null); return; }
    calcRoute(
      { lat: selectedDriver.current_lat!, lon: selectedDriver.current_lon! },
      { lat: destWh.latitude, lon: destWh.longitude }
    ).then(r => setRouteEta(r)).catch(() => setRouteEta(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriver?.id, activeJob?.id]);

  // ── ETA midpoint chip (separate effect so route doesn't redraw) ────────────
  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer || !mapRef.current) return;
    if (etaMarkerRef.current) { layer.removeLayer(etaMarkerRef.current); etaMarkerRef.current = null; }
    const mid = routeMidRef.current;
    if (!mid || !routeEta) return;
    etaMarkerRef.current = L.marker(mid, {
      icon: L.divIcon({ className:"", html: etaChip(routeEta.distKm, routeEta.minutes), iconAnchor:[60,18] }),
      interactive: false, zIndexOffset: 500,
    }).addTo(layer);
  }, [routeEta]);

  // ── Route visualisation ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    etaMarkerRef.current = null;
    routeMidRef.current  = null;

    if (!selectedDriver?.current_lat || !selectedDriver.current_lon) return;
    if (!destWh) {
      mapRef.current?.flyTo([selectedDriver.current_lat, selectedDriver.current_lon], 11, { duration:1 });
      return;
    }

    const from: [number,number] = [selectedDriver.current_lat, selectedDriver.current_lon];
    const to:   [number,number] = [destWh.latitude, destWh.longitude];
    routeMidRef.current = [(from[0]+to[0])/2, (from[1]+to[1])/2];

    // Glow layers
    L.polyline([from,to], { color: ROUTE_BLUE, weight:28, opacity:.05, lineCap:"round" }).addTo(layer);
    L.polyline([from,to], { color: ROUTE_BLUE, weight:12, opacity:.11, lineCap:"round" }).addTo(layer);
    // Solid base
    L.polyline([from,to], { color: ROUTE_BLUE, weight:4.5, opacity:.92, lineCap:"round" }).addTo(layer);
    // Marching white dashes
    L.polyline([from,to], { color:"#fff", weight:2.5, opacity:.85, dashArray:"8 13", className:"rm", lineCap:"round" }).addTo(layer);

    // Origin dot (driver colour)
    const dBg = STATUS[selectedDriver.status]?.bg ?? ROUTE_BLUE;
    L.circleMarker(from, { radius:6, fillColor:dBg, fillOpacity:1, color:"#fff", weight:2.5 }).addTo(layer);

    // Destination concentric rings
    [[28,.09,.22],[16,.18,.4],[9,1,1]].forEach(([r,fo,o]) =>
      L.circleMarker(to, { radius:r, fillColor:ROUTE_BLUE, fillOpacity:fo, color:ROUTE_BLUE, weight:1.4, opacity:o }).addTo(layer)
    );
    L.circleMarker(to, { radius:9, fillOpacity:1, fillColor:ROUTE_BLUE, color:"#fff", weight:3 }).addTo(layer);

    // Immediate chip if ETA already known
    if (routeEta) {
      const mid = routeMidRef.current!;
      etaMarkerRef.current = L.marker(mid, {
        icon: L.divIcon({ className:"", html:etaChip(routeEta.distKm, routeEta.minutes), iconAnchor:[60,18] }),
        interactive:false, zIndexOffset:500,
      }).addTo(layer);
    }

    mapRef.current?.flyToBounds(L.latLngBounds([from,to]), { padding:[100,100], maxZoom:10, duration:1.1 });
  // routeEta intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriver, destWh]);

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

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   drivers.length,
    onMap:   drivers.filter(d => d.current_lat != null).length,
    active:  drivers.filter(d => ["AVAILABLE","ON_SHIFT","ON_ROUTE"].includes(d.status) && d.current_lat != null).length,
    delayed: drivers.filter(d => d.status === "DELAYED").length,
    offline: drivers.filter(d => d.current_lat == null).length,
  }), [drivers]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────
  const fmtTime = (m: number) => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m} min`;

  function PanelContent() {
    switch (panel.kind) {

      case "idle": return (
        <div className="flex flex-col items-center gap-1.5 py-2 text-center">
          <div style={{ fontSize:18, color:"#dadce0" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="currentColor"/>
            </svg>
          </div>
          <p style={{ fontSize:12, color:"#9aa0a6", lineHeight:1.5 }}>
            Click a driver to select, then click a warehouse to calculate distance & ETA
          </p>
        </div>
      );

      case "driver": {
        const { driver, job } = panel;
        const s = STATUS[driver.status] ?? DEF_STATUS;
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                style={{ background: s.bg, boxShadow:`0 0 0 2px #fff,0 0 0 3.5px ${s.bg}` }}>
                {(driver.name[0]??"?").toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:"#202124" }}>{driver.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="size-1.5 rounded-full" style={{ background: s.bg }} />
                  <span style={{ fontSize:11, color:"#5f6368" }}>{s.label}</span>
                </div>
              </div>
              <div className="ml-auto">
                <span style={{ fontSize:10, background:"#f1f3f4", color:"#5f6368", borderRadius:6, padding:"2px 7px", fontFamily:"monospace" }}>
                  Pinned
                </span>
              </div>
            </div>

            {driver.current_lat != null && (
              <div style={{ fontSize:11, fontFamily:"monospace", color:"#9aa0a6", letterSpacing:".03em" }}>
                {driver.current_lat.toFixed(5)}, {driver.current_lon!.toFixed(5)}
              </div>
            )}

            {job && (
              <div className="rounded-lg px-3 py-2" style={{ background:"#f8f9fa", border:"1px solid #e8eaed" }}>
                <div style={{ fontSize:10, color:"#9aa0a6", textTransform:"uppercase", letterSpacing:".06em", marginBottom:2 }}>Active job</div>
                <div style={{ fontSize:12, fontWeight:600, color:"#202124" }}>{job.reference}</div>
                <div style={{ fontSize:11, color:"#5f6368" }}>{job.status.replace(/_/g," ")}</div>
              </div>
            )}

            <div style={{ fontSize:11, color:"#9aa0a6", paddingTop:2 }}>
              Now click a warehouse marker to calculate road distance & ETA
            </div>
          </div>
        );
      }

      case "warehouse": {
        const { wh } = panel;
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background:"#fce8e6", border:"1.5px solid #ea4335" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#ea4335"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:"#202124", letterSpacing:".04em" }}>{wh.code}</div>
                <div style={{ fontSize:11, color:"#5f6368" }}>{wh.name}</div>
              </div>
              <button
                onClick={() => setPanel({ kind:"idle" })}
                className="ml-auto size-6 flex items-center justify-center rounded-full"
                style={{ color:"#9aa0a6", background:"#f1f3f4", fontSize:12 }}
              >✕</button>
            </div>
            {wh.address && (
              <div style={{ fontSize:11, color:"#5f6368", lineHeight:1.5, paddingTop:2 }}>{wh.address}</div>
            )}
            {!pinnedDriver && (
              <div style={{ fontSize:11, color:"#9aa0a6" }}>Select a driver first to calculate ETA to this warehouse</div>
            )}
          </div>
        );
      }

      case "loading": {
        const { driver, wh } = panel;
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm" style={{ color:"#5f6368" }}>
              <span style={{ fontWeight:600, color:"#202124" }}>{driver.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dadce0" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <span style={{ fontWeight:600, color:"#ea4335" }}>{wh.code}</span>
            </div>
            <div className="flex items-center gap-2" style={{ color: ROUTE_BLUE }}>
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-t-transparent" style={{ borderColor:`${ROUTE_BLUE}30`, borderTopColor:ROUTE_BLUE }} />
              <span style={{ fontSize:12 }}>Calculating road route…</span>
            </div>
          </div>
        );
      }

      case "eta": {
        const { driver, wh, distKm, minutes } = panel;
        return (
          <div className="space-y-3">
            {/* Route summary row */}
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                style={{ fontSize:9, background: STATUS[driver.status]?.bg ?? ROUTE_BLUE }}>
                {(driver.name[0]??"?").toUpperCase()}
              </div>
              <div style={{ flex:1, height:1, background: ROUTE_BLUE, opacity:.3 }} />
              <div className="size-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background:"#ea4335" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
              </div>
              <div style={{ fontSize:11, fontWeight:700, color:"#ea4335" }}>{wh.code}</div>
            </div>

            {/* Result card */}
            <div className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ background: ROUTE_BLUE }}>
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:"#fff", lineHeight:1 }}>{distKm.toFixed(1)}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,.7)", marginTop:2 }}>km by road</div>
              </div>
              <div style={{ width:1, height:32, background:"rgba(255,255,255,.25)" }} />
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:"#fff", lineHeight:1 }}>{fmtTime(minutes)}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,.7)", marginTop:2 }}>estimated</div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPanel({ kind:"driver", driver })}
                style={{ flex:1, fontSize:11, color:ROUTE_BLUE, background:"#e8f0fe", border:"none", borderRadius:8, padding:"6px 0", cursor:"pointer", fontWeight:600 }}
              >
                ← Back to driver
              </button>
              <button
                onClick={() => { setPanel({ kind:"idle" }); setPinned(null); }}
                style={{ flex:1, fontSize:11, color:"#5f6368", background:"#f1f3f4", border:"none", borderRadius:8, padding:"6px 0", cursor:"pointer" }}
              >
                Clear
              </button>
            </div>
          </div>
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Selected driver label — top-centre ───────────────────────────── */}
      {selectedDriver && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[999]" style={{ pointerEvents:"none" }}>
          <div className="flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ background:"#fff", border:"1.5px solid #dadce0", boxShadow:"0 2px 8px rgba(0,0,0,.13)", fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif" }}>
            <span className="size-2 rounded-full"
              style={{ background: STATUS[selectedDriver.status]?.bg ?? ROUTE_BLUE, boxShadow:`0 0 5px ${STATUS[selectedDriver.status]?.ring ?? "rgba(26,115,232,.4)"}` }} />
            <span style={{ fontSize:12, fontWeight:600, color:"#202124" }}>{selectedDriver.name}</span>
            <span style={{ fontSize:10, color:"#9aa0a6", textTransform:"uppercase", letterSpacing:".06em", fontFamily:"monospace" }}>
              {selectedDriver.status.replace(/_/g," ")}
            </span>
            {routeEta && activeJob && (
              <>
                <div style={{ width:1, height:12, background:"#dadce0", margin:"0 2px" }} />
                <span style={{ fontSize:11, fontWeight:700, color: ROUTE_BLUE }}>{routeEta.distKm.toFixed(1)} km</span>
                <span style={{ fontSize:11, color:"#5f6368" }}>{fmtTime(routeEta.minutes)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom-left: stat pills ───────────────────────────────────────── */}
      <div className="absolute bottom-5 left-3 z-[998] flex flex-col gap-1.5" style={{ pointerEvents:"none" }}>
        <Pill dot="#1a73e8" count={stats.onMap} label="on map" sub={stats.offline ? `· ${stats.offline} offline` : ""} />
        {stats.active  > 0 && <Pill dot="#34a853" count={stats.active}  label="active"  pulse />}
        {stats.delayed > 0 && <Pill dot="#ea4335" count={stats.delayed} label="delayed" warn />}
      </div>

      {/* ── Bottom-right: unified info/calc panel ─────────────────────────── */}
      <div className="absolute bottom-5 right-3 z-[998] w-64" style={{ pointerEvents:"auto" }}>
        <div className="rounded-2xl p-3.5" style={{
          background: "#fff",
          border: "1.5px solid #dadce0",
          boxShadow: "0 4px 18px rgba(0,0,0,.11),0 1px 4px rgba(0,0,0,.07)",
          fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
        }}>
          <PanelContent />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny stat pill sub-component
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ dot, count, label, sub="", pulse=false, warn=false }: {
  dot: string; count: number; label: string; sub?: string; pulse?: boolean; warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{ background:"#fff", border:`1.5px solid ${warn ? "#fbbc04" : "#dadce0"}`, boxShadow:"0 1px 4px rgba(0,0,0,.10)", fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif" }}>
      <span className={`size-1.5 rounded-full flex-shrink-0 ${pulse ? "animate-pulse" : ""}`} style={{ background: dot }} />
      <span style={{ fontSize:11, fontWeight:600, color:"#202124" }}>{count}</span>
      <span style={{ fontSize:10, color: warn ? "#b45309" : "#9aa0a6", textTransform:"uppercase", letterSpacing:".06em", fontFamily:"monospace" }}>{label}</span>
      {sub && <span style={{ fontSize:10, color:"#c4c7cb", fontFamily:"monospace" }}>{sub}</span>}
    </div>
  );
}
