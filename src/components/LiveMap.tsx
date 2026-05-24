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

// ── Status colours ────────────────────────────────────────────────────────────
const S_COLOR: Record<string, { fill: string; glow: string; text: string }> = {
  AVAILABLE: { fill: "#1a73e8", glow: "rgba(26,115,232,0.35)", text: "#fff" },
  ON_SHIFT:  { fill: "#1a73e8", glow: "rgba(26,115,232,0.35)", text: "#fff" },
  ON_ROUTE:  { fill: "#34a853", glow: "rgba(52,168,83,0.35)",  text: "#fff" },
  DELAYED:   { fill: "#fbbc04", glow: "rgba(251,188,4,0.35)",  text: "#202124" },
  OFF_SHIFT: { fill: "#9aa0a6", glow: "rgba(154,160,166,0.25)", text: "#fff" },
  ON_BREAK:  { fill: "#fa7b17", glow: "rgba(250,123,23,0.35)", text: "#fff" },
};
const DEFAULT_COLOR = { fill: "#1a73e8", glow: "rgba(26,115,232,0.35)", text: "#fff" };
const ROUTE_BLUE = "#1a73e8";

// ── Marker HTML generators ───────────────────────────────────────────────────

function driverMarkerHtml(name: string, status: string, selected: boolean): string {
  const { fill, text } = S_COLOR[status] ?? DEFAULT_COLOR;
  const initial = (name?.[0] ?? "?").toUpperCase();
  const size = selected ? 42 : 34;
  const fontSize = selected ? 17 : 13;
  // Google Maps–style: white ring + colored fill + subtle shadow
  const shadow = selected
    ? `0 0 0 3px #fff, 0 0 0 5.5px ${fill}, 0 6px 20px rgba(0,0,0,0.22)`
    : `0 0 0 2.5px #fff, 0 0 0 4px ${fill}, 0 3px 10px rgba(0,0,0,0.18)`;
  const pulse = status !== "OFF_SHIFT" && !selected
    ? `<div style="position:absolute;inset:-9px;border-radius:50%;border:2px solid ${fill};animation:driver-ping 2.2s ease-out infinite;pointer-events:none;opacity:0.55"></div>`
    : "";
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${fill};box-shadow:${shadow};
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif;
    font-weight:700;font-size:${fontSize}px;color:${text};
    cursor:pointer;position:relative;
    ${selected ? "transform:scale(1.06);z-index:1000;" : ""}
  ">${initial}${pulse}</div>`;
}

function warehouseMarkerHtml(code: string): string {
  // Google Maps place chip: white pill, red icon circle, bold code text
  const displayCode = code.toUpperCase();
  return `<div style="
    display:flex;align-items:center;gap:6px;
    background:#ffffff;
    border:1.5px solid #dadce0;
    border-radius:22px;
    padding:5px 12px 5px 7px;
    box-shadow:0 2px 6px rgba(0,0,0,0.16),0 1px 3px rgba(0,0,0,0.1);
    cursor:pointer;white-space:nowrap;
    font-family:-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif;
    min-width:52px;
  ">
    <div style="
      width:22px;height:22px;border-radius:50%;
      background:#ea4335;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
    ">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      </svg>
    </div>
    <span style="font-weight:600;font-size:12.5px;color:#202124;letter-spacing:0.03em">${displayCode}</span>
  </div>`;
}

function popupHtml(title: string, sub: string, extra = ""): string {
  return `<div style="
    font-family:-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif;
    min-width:160px;padding:4px 2px;color:#202124;
  ">
    <div style="font-weight:600;font-size:14px;margin-bottom:4px">${title}</div>
    <div style="font-size:11px;color:#fff;background:#5f6368;padding:2px 7px;border-radius:4px;display:inline-block;text-transform:uppercase;letter-spacing:.06em">${sub}</div>
    ${extra ? `<div style="font-size:12px;color:#5f6368;margin-top:6px">${extra}</div>` : ""}
  </div>`;
}

function etaChipHtml(distKm: number, minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
  return `<div style="
    background:#1a73e8;border-radius:20px;
    padding:6px 14px;
    display:flex;align-items:center;gap:9px;
    box-shadow:0 2px 14px rgba(26,115,232,0.45),0 1px 5px rgba(0,0,0,0.12);
    font-family:-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif;
    white-space:nowrap;pointer-events:none;
  ">
    <span style="font-size:13px;font-weight:700;color:#fff">${distKm.toFixed(1)} km</span>
    <div style="width:1px;height:14px;background:rgba(255,255,255,0.35)"></div>
    <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.92)">${timeStr}</span>
  </div>`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const driverLayer    = useRef<L.LayerGroup | null>(null);
  const warehouseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer     = useRef<L.LayerGroup | null>(null);
  const etaMarkerRef   = useRef<L.Marker | null>(null);
  const routeMidRef    = useRef<[number, number] | null>(null);

  const [selectedCalcDriver, setSelectedCalcDriver] = useState<Driver | null>(null);
  const [calcResult, setCalcResult]     = useState<{ distanceKm: number; minutes: number } | null>(null);
  const [calcLoading, setCalcLoading]   = useState(false);
  const [routeEta, setRouteEta]         = useState<{ distanceKm: number; minutes: number } | null>(null);

  // ── Inject animation CSS ──────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("livemap-css")) return;
    const style = document.createElement("style");
    style.id = "livemap-css";
    style.textContent = `
      @keyframes driver-ping {
        0%   { transform:scale(1);   opacity:0.55; }
        75%  { transform:scale(2.6); opacity:0; }
        100% { transform:scale(2.6); opacity:0; }
      }
      @keyframes route-flow {
        to { stroke-dashoffset: -24; }
      }
      .route-marching path {
        animation: route-flow 0.9s linear infinite;
      }
      .leaflet-popup-content-wrapper {
        border-radius: 14px !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.14), 0 1px 6px rgba(0,0,0,0.08) !important;
        border: 1px solid #dadce0 !important;
        padding: 12px 16px !important;
      }
      .leaflet-popup-content { margin: 0 !important; }
      .leaflet-popup-tip-container { display:none; }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("livemap-css")?.remove(); };
  }, []);

  // ── Init map (Google Maps road tiles) ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [53.5, -1.5], zoom: 6,
      zoomControl: false, attributionControl: true,
    });

    L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      maxZoom: 20,
      attribution: "© Google Maps",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    warehouseLayer.current = L.layerGroup().addTo(map);
    routeLayer.current     = L.layerGroup().addTo(map);
    driverLayer.current    = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Fit bounds on first load ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const pts: [number, number][] = [
      ...warehouses.map(w => [w.latitude, w.longitude] as [number, number]),
      ...drivers.filter(d => d.current_lat != null).map(d => [d.current_lat!, d.current_lon!] as [number, number]),
    ];
    if (pts.length === 0) return;
    mapRef.current.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 9, duration: 1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.length > 0]);

  // ── Warehouse markers ──────────────────────────────────────────────────────
  useEffect(() => {
    const layer = warehouseLayer.current;
    if (!layer) return;
    layer.clearLayers();
    warehouses.forEach(w => {
      const icon = L.divIcon({
        className: "",
        html: warehouseMarkerHtml(w.code),
        iconAnchor: [0, 16],
      });
      const marker = L.marker([w.latitude, w.longitude], { icon })
        .bindPopup(
          L.popup({ className: "gmap-popup", offset: [40, -4] })
            .setContent(popupHtml(w.name, w.code, w.address ?? ""))
        );
      marker.on("click", () => {
        if (selectedCalcDriver?.current_lat != null && selectedCalcDriver?.current_lon != null) {
          setCalcLoading(true);
          calcRoute(
            { lat: selectedCalcDriver.current_lat, lon: selectedCalcDriver.current_lon },
            { lat: w.latitude, lon: w.longitude }
          )
            .then(r => setCalcResult(r))
            .catch(() => { setCalcResult(null); alert("Routing failed – try again."); })
            .finally(() => setCalcLoading(false));
        } else {
          alert("Select a driver first, then click a warehouse.");
        }
      });
      marker.addTo(layer);
    });
  }, [warehouses, selectedCalcDriver]);

  // ── Driver markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const layer = driverLayer.current;
    if (!layer) return;
    layer.clearLayers();
    drivers.forEach(d => {
      if (d.current_lat == null || d.current_lon == null) return;
      const sel  = d.id === selectedDriverId;
      const icon = L.divIcon({
        className: "",
        html: driverMarkerHtml(d.name, d.status, sel),
        iconSize:   sel ? [42, 42] : [34, 34],
        iconAnchor: sel ? [21, 21] : [17, 17],
      });
      const activeJob = jobs.find(j =>
        j.assigned_driver_id === d.id &&
        ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
      );
      const extra  = activeJob ? `Job: <b>${activeJob.reference}</b>` : "";
      const lastGps = d.last_update_time
        ? `GPS: ${new Date(d.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";
      const marker = L.marker([d.current_lat, d.current_lon], { icon, zIndexOffset: sel ? 1000 : 0 })
        .bindPopup(
          L.popup({ offset: [0, -10] }).setContent(
            popupHtml(d.name, d.status.replace(/_/g, " "), [extra, lastGps].filter(Boolean).join(" · "))
          )
        );
      marker.on("click", () => {
        onSelectDriver?.(d.id);
        setSelectedCalcDriver(d);
        setCalcResult(null);
      });
      marker.addTo(layer);
    });
  }, [drivers, selectedDriverId, onSelectDriver, jobs]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const selectedDriver = useMemo(
    () => drivers.find(d => d.id === selectedDriverId),
    [drivers, selectedDriverId]
  );
  const activeJob = useMemo(
    () => jobs.find(j =>
      j.assigned_driver_id === selectedDriverId &&
      ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)
    ),
    [jobs, selectedDriverId]
  );
  const destWarehouse = useMemo(() => {
    if (!activeJob) return null;
    return warehouses.find(w =>
      ["ASSIGNED","IN_PROGRESS"].includes(activeJob.status)
        ? w.id === activeJob.origin_warehouse_id
        : w.id === activeJob.destination_warehouse_id
    ) ?? null;
  }, [activeJob, warehouses]);

  // ── Auto ETA for active route (separate from manual calc) ─────────────────
  useEffect(() => {
    if (!selectedDriver?.current_lat || !destWarehouse) {
      setRouteEta(null);
      return;
    }
    calcRoute(
      { lat: selectedDriver.current_lat!, lon: selectedDriver.current_lon! },
      { lat: destWarehouse.latitude,      lon: destWarehouse.longitude }
    ).then(setRouteEta).catch(() => setRouteEta(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriver?.id, activeJob?.id]);

  // ── ETA chip: re-render when routeEta arrives without redrawing route ──────
  useEffect(() => {
    if (!routeLayer.current || !mapRef.current) return;
    if (etaMarkerRef.current) {
      routeLayer.current.removeLayer(etaMarkerRef.current);
      etaMarkerRef.current = null;
    }
    const mid = routeMidRef.current;
    if (!mid || !routeEta) return;
    const marker = L.marker(mid, {
      icon: L.divIcon({
        className: "",
        html: etaChipHtml(routeEta.distanceKm, routeEta.minutes),
        iconAnchor: [65, 20],
      }),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(routeLayer.current);
    etaMarkerRef.current = marker;
  }, [routeEta]);

  // ── Route visualisation ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    etaMarkerRef.current = null;
    routeMidRef.current  = null;

    if (!selectedDriver?.current_lat || !selectedDriver.current_lon) return;

    if (!destWarehouse) {
      mapRef.current?.flyTo([selectedDriver.current_lat, selectedDriver.current_lon], 11, {
        duration: 1.0, easeLinearity: 0.3,
      });
      return;
    }

    const from: [number, number] = [selectedDriver.current_lat, selectedDriver.current_lon];
    const to:   [number, number] = [destWarehouse.latitude, destWarehouse.longitude];
    const mid:  [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    routeMidRef.current = mid;

    // ── Route line: 4 layers for the Google Maps look ──────────────────────
    // 1. Wide outer glow
    L.polyline([from, to], {
      color: ROUTE_BLUE, weight: 30, opacity: 0.05, lineCap: "round",
    }).addTo(layer);
    // 2. Mid aura
    L.polyline([from, to], {
      color: ROUTE_BLUE, weight: 14, opacity: 0.12, lineCap: "round",
    }).addTo(layer);
    // 3. Solid base
    L.polyline([from, to], {
      color: ROUTE_BLUE, weight: 5, opacity: 0.92, lineCap: "round",
    }).addTo(layer);
    // 4. White marching dashes (flowing direction cue)
    L.polyline([from, to], {
      color: "#ffffff", weight: 2.5, opacity: 0.85,
      dashArray: "9 13",
      className: "route-marching",
      lineCap: "round",
    }).addTo(layer);

    // ── Driver origin dot ──────────────────────────────────────────────────
    const driverFill = S_COLOR[selectedDriver.status]?.fill ?? ROUTE_BLUE;
    L.circleMarker(from, {
      radius: 7, fillColor: driverFill, fillOpacity: 1,
      color: "#fff", weight: 2.5,
    }).addTo(layer);

    // ── Destination rings (Google Maps destination style) ──────────────────
    L.circleMarker(to, {
      radius: 28, fillColor: ROUTE_BLUE, fillOpacity: 0.09,
      color: ROUTE_BLUE, weight: 1.2, opacity: 0.25,
    }).addTo(layer);
    L.circleMarker(to, {
      radius: 16, fillColor: ROUTE_BLUE, fillOpacity: 0.18,
      color: ROUTE_BLUE, weight: 1.5, opacity: 0.4,
    }).addTo(layer);
    L.circleMarker(to, {
      radius: 9, fillColor: ROUTE_BLUE, fillOpacity: 1,
      color: "#fff", weight: 3,
    }).addTo(layer);
    // Destination dot tooltip
    L.circleMarker(to, { radius: 9, fillOpacity: 0, color: "transparent", weight: 0 })
      .bindTooltip(destWarehouse.name, { permanent: false, direction: "top", className: "gmap-tooltip" })
      .addTo(layer);

    // ETA chip placed immediately if routeEta is already available
    if (routeEta) {
      const m = L.marker(mid, {
        icon: L.divIcon({ className: "", html: etaChipHtml(routeEta.distanceKm, routeEta.minutes), iconAnchor: [65, 20] }),
        interactive: false, zIndexOffset: 500,
      }).addTo(layer);
      etaMarkerRef.current = m;
    }

    mapRef.current?.flyToBounds(L.latLngBounds([from, to]), {
      padding: [110, 110], maxZoom: 10, duration: 1.15,
    });
  // routeEta intentionally omitted – handled by its own effect above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriver, destWarehouse]);

  // ── OSRM helper ───────────────────────────────────────────────────────────
  async function calcRoute(
    from: { lat: number; lon: number },
    to:   { lat: number; lon: number }
  ): Promise<{ distanceKm: number; minutes: number }> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error("Routing unavailable");
    const data = await res.json();
    if (!data.routes?.length) throw new Error("No route");
    const { distance, duration } = data.routes[0];
    return { distanceKm: distance / 1000, minutes: Math.round(duration / 60) };
  }

  // ── Overlay stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    onMap:   drivers.filter(d => d.current_lat != null).length,
    active:  drivers.filter(d => ["AVAILABLE","ON_SHIFT","ON_ROUTE"].includes(d.status) && d.current_lat != null).length,
    delayed: drivers.filter(d => d.status === "DELAYED").length,
    offline: drivers.filter(d => d.current_lat == null).length,
  }), [drivers]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Top pill: selected driver + live ETA ──────────────────────────── */}
      {selectedDriver && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[999]" style={{ pointerEvents: "none" }}>
          <div
            className="flex items-center gap-2.5 rounded-full px-4 py-2 border"
            style={{
              background: "#fff",
              borderColor: "#dadce0",
              boxShadow: "0 2px 10px rgba(0,0,0,0.14)",
              fontFamily: "-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif",
            }}
          >
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{
                background: S_COLOR[selectedDriver.status]?.fill ?? ROUTE_BLUE,
                boxShadow: `0 0 6px ${S_COLOR[selectedDriver.status]?.glow ?? "rgba(26,115,232,0.4)"}`,
              }}
            />
            <span className="text-sm font-semibold text-gray-800">{selectedDriver.name}</span>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "#5f6368", fontFamily: "monospace" }}
            >
              {selectedDriver.status.replace(/_/g, " ")}
            </span>
            {routeEta && activeJob && (
              <>
                <div className="w-px h-4 mx-1" style={{ background: "#dadce0" }} />
                <span className="text-xs font-bold" style={{ color: ROUTE_BLUE }}>
                  {routeEta.distanceKm.toFixed(1)} km
                </span>
                <span className="text-xs" style={{ color: "#5f6368" }}>
                  {routeEta.minutes >= 60
                    ? `${Math.floor(routeEta.minutes / 60)}h ${routeEta.minutes % 60}m`
                    : `${routeEta.minutes} min`}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom-left: status legend ────────────────────────────────────── */}
      <div
        className="absolute bottom-6 left-3 z-[999] flex flex-col gap-1.5"
        style={{ pointerEvents: "none" }}
      >
        {[
          { dot: "#1a73e8", count: stats.onMap,   label: "on map",
            extra: stats.offline > 0 ? `· ${stats.offline} offline` : "" },
          stats.active  > 0 && { dot: "#34a853", count: stats.active,  label: "active",  pulse: true },
          stats.delayed > 0 && { dot: "#fbbc04", count: stats.delayed, label: "delayed", warn: true },
        ].filter(Boolean).map((item: any, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 border"
            style={{
              background: "#fff",
              borderColor: item.warn ? "#fbbc04" : "#dadce0",
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
              fontFamily: "-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif",
            }}
          >
            <span
              className={`size-2 rounded-full ${item.pulse ? "animate-pulse" : ""}`}
              style={{ background: item.dot }}
            />
            <span className="text-xs font-semibold" style={{ color: "#202124" }}>{item.count}</span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: item.warn ? "#b06000" : "#5f6368", fontFamily: "monospace" }}>
              {item.label}
            </span>
            {item.extra && (
              <span className="text-[10px]" style={{ color: "#9aa0a6", fontFamily: "monospace" }}>{item.extra}</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Bottom-right: driver → warehouse manual calc panel ────────────── */}
      <div className="absolute bottom-6 right-3 z-[999] w-72" style={{ pointerEvents: "auto" }}>
        <div
          className="rounded-2xl border p-3 text-sm"
          style={{
            background: "#fff",
            borderColor: "#dadce0",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            fontFamily: "-apple-system,BlinkMacSystemFont,'Google Sans',sans-serif",
          }}
        >
          {selectedCalcDriver ? (
            <>
              <div
                className="flex justify-between items-center pb-2 mb-2"
                style={{ borderBottom: "1px solid #f1f3f4" }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="size-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: S_COLOR[selectedCalcDriver.status]?.fill ?? ROUTE_BLUE }}
                  >
                    {(selectedCalcDriver.name?.[0] ?? "?").toUpperCase()}
                  </div>
                  <span className="font-semibold" style={{ color: "#202124" }}>{selectedCalcDriver.name}</span>
                </div>
                <button
                  onClick={() => { setSelectedCalcDriver(null); setCalcResult(null); }}
                  className="text-xs rounded-full px-2 py-0.5"
                  style={{ color: "#5f6368", background: "#f1f3f4" }}
                >
                  Clear
                </button>
              </div>

              <div className="space-y-2 text-xs" style={{ color: "#5f6368" }}>
                <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {selectedCalcDriver.current_lat?.toFixed(5)}, {selectedCalcDriver.current_lon?.toFixed(5)}
                </div>

                {calcLoading && (
                  <div className="flex items-center gap-2 pt-1" style={{ color: ROUTE_BLUE }}>
                    <div
                      className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-t-transparent"
                      style={{ borderColor: `${ROUTE_BLUE}40`, borderTopColor: "transparent" }}
                    />
                    Calculating road route…
                  </div>
                )}

                {calcResult && !calcLoading && (
                  <div
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 mt-1"
                    style={{ background: ROUTE_BLUE }}
                  >
                    <span className="font-bold text-sm text-white">{calcResult.distanceKm.toFixed(1)} km</span>
                    <div className="w-px h-4 mx-1" style={{ background: "rgba(255,255,255,0.35)" }} />
                    <span className="text-sm text-white">
                      {calcResult.minutes >= 60
                        ? `${Math.floor(calcResult.minutes / 60)}h ${calcResult.minutes % 60}m`
                        : `${calcResult.minutes} min`}
                    </span>
                  </div>
                )}

                {!calcLoading && !calcResult && (
                  <p style={{ color: "#9aa0a6", paddingTop: 4 }}>
                    Now click any warehouse marker to get road distance & ETA
                  </p>
                )}
              </div>
            </>
          ) : (
            <div
              className="text-xs text-center py-1.5"
              style={{ color: "#9aa0a6" }}
            >
              Click a driver → click a warehouse to get distance & ETA
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
