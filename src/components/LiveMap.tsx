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

export function LiveMap({ drivers, warehouses, jobs, selectedDriverId, onSelectDriver }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverLayer = useRef<L.LayerGroup | null>(null);
  const warehouseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [53.2, -1.8],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    warehouseLayer.current = L.layerGroup().addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    driverLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Warehouses
  useEffect(() => {
    const layer = warehouseLayer.current;
    if (!layer) return;
    layer.clearLayers();
    warehouses.forEach((w) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="warehouse-marker">${w.code.slice(0,3)}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([w.latitude, w.longitude], { icon })
        .bindPopup(
          `<div style="font-family:'IBM Plex Mono',monospace"><div style="font-weight:700;font-size:12px">${w.code}</div><div style="opacity:.7;font-size:11px">${w.name}</div></div>`
        )
        .addTo(layer);
    });
  }, [warehouses]);

  // Drivers
  useEffect(() => {
    const layer = driverLayer.current;
    if (!layer) return;
    layer.clearLayers();
    drivers.forEach((d) => {
      if (d.current_lat == null || d.current_lon == null) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="driver-marker status-${d.status}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const m = L.marker([d.current_lat, d.current_lon], { icon })
        .bindPopup(
          `<div style="font-family:Inter,sans-serif"><div style="font-weight:600;font-size:13px">${d.name}</div><div style="opacity:.7;font-size:11px;font-family:'IBM Plex Mono',monospace">${d.status}</div></div>`
        );
      m.on("click", () => onSelectDriver?.(d.id));
      m.addTo(layer);
    });
  }, [drivers, onSelectDriver]);

  // Route line for selected driver's active job
  const selectedDriver = useMemo(() => drivers.find((d) => d.id === selectedDriverId), [drivers, selectedDriverId]);
  const activeJob = useMemo(
    () => jobs.find((j) => j.assigned_driver_id === selectedDriverId && (j.status === "IN_PROGRESS" || j.status === "ASSIGNED" || j.status === "EN_ROUTE_DELIVERY" || j.status === "ARRIVED_PICKUP")),
    [jobs, selectedDriverId]
  );

  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!selectedDriver?.current_lat || !selectedDriver.current_lon || !activeJob) return;
    const destWh = warehouses.find((w) =>
      activeJob.status === "ASSIGNED" || activeJob.status === "IN_PROGRESS"
        ? w.id === activeJob.origin_warehouse_id
        : w.id === activeJob.destination_warehouse_id
    );
    if (!destWh) return;
    L.polyline(
      [
        [selectedDriver.current_lat, selectedDriver.current_lon],
        [destWh.latitude, destWh.longitude],
      ],
      { color: "#5fd4e6", weight: 2, opacity: 0.9, dashArray: "6 6" }
    ).addTo(layer);
    mapRef.current?.fitBounds(
      L.latLngBounds([
        [selectedDriver.current_lat, selectedDriver.current_lon],
        [destWh.latitude, destWh.longitude],
      ]),
      { padding: [60, 60], maxZoom: 9 }
    );
  }, [selectedDriver, activeJob, warehouses]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
