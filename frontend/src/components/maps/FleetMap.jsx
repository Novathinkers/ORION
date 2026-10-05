import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { useMapsStatus } from "./MapProvider";
import { useTheme } from "../../contexts/ThemeContext";
import StatusBadge from "../shared/StatusBadge";
import { riskLevelFor } from "../../lib/riskEngine";
import { useAuth } from "../../contexts/AuthContext";
import { markDangerZone } from "../../lib/dataService";

// Standard, high-detail OpenStreetMap tile layer (100% free, publicly accessible, NO API KEY REQUIRED, NO WATERMARK)
const TILE_URL_OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_URL_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

function riskColor(score) {
  if (score <= 25) return "#3FBF7F";
  if (score <= 50) return "#E8C547";
  if (score <= 75) return "#F0924B";
  return "#C4306B";
}

function vehicleIcon(color, selected) {
  const ring = selected
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;background:${color};opacity:0.35;" class="animate-pulse-ring"></div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:18px;height:18px;">${ring}<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2.5px solid #0B1220;box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function incidentIcon(status) {
  const isBlocked = status === "blocked";
  const color = isBlocked ? "#C4306B" : status === "pending_review" ? "#F5A623" : "#E85D4C";
  const shadowColor = isBlocked ? "rgba(196,48,107,0.4)" : status === "pending_review" ? "rgba(245,166,35,0.3)" : "rgba(232,93,76,0.3)";
  const symbol = isBlocked ? "⛔" : status === "pending_review" ? "⚠️" : "🔴";

  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:1.5px solid #0B1220;box-shadow:0 0 0 6px ${shadowColor};display:flex;align-items:center;justify-content:center;font-size:9px;">${symbol}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function sosMarkerIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:24px;height:24px;"><div style="position:absolute;inset:-8px;border-radius:50%;background:#EF4444;opacity:0.45;" class="animate-ping"></div><div style="width:24px;height:24px;border-radius:50%;background:#EF4444;border:2px solid #FFFFFF;box-shadow:0 0 12px rgba(239,68,68,0.9);display:flex;align-items:center;justify-content:center;font-size:12px;color:white;font-weight:bold;">🚨</div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function inactivityMarkerIcon(level) {
  const isHigh = level === "HIGH_RISK_INCIDENT" || level === "POSSIBLE_INCIDENT";
  const isWeak = level === "CONNECTION_WEAK";
  const color = isHigh ? "#EF4444" : isWeak ? "#F59E0B" : "#F97316";
  const symbol = isHigh ? "🔴" : isWeak ? "🟡" : "📡";

  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:24px;height:24px;"><div style="position:absolute;inset:-6px;border-radius:50%;background:${color};opacity:0.35;" class="animate-pulse"></div><div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid #FFFFFF;box-shadow:0 0 10px ${color};display:flex;align-items:center;justify-content:center;font-size:11px;">${symbol}</div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    const valid = (points || []).filter(Boolean);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [points, map]);
  return null;
}

function DemoFleetMap({ vehicles, incidents, onSelect, selectedId }) {
  const W = 900, H = 520, padding = 50;
  const points = useMemo(() => {
    const pts = vehicles.map((v) => v.position).filter(Boolean);
    const incPts = incidents.map((i) => ({ lat: i.lat, lng: i.lng }));
    return [...pts, ...incPts, INDIA_CENTER, { lat: 28.6, lng: 77.2 }, { lat: 13.0, lng: 80.2 }];
  }, [vehicles, incidents]);

  const bounds = useMemo(() => {
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    return {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    };
  }, [points]);

  const project = (p) => {
    const x = padding + ((p.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * (W - padding * 2);
    const y = H - padding - ((p.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * (H - padding * 2);
    return { x, y };
  };

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-base-border" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <rect width={W} height={H} fill="var(--color-base-panel, #0F1930)" />
        <pattern id="fleetGrid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="var(--color-base-border, #1A2438)" strokeWidth="1" />
        </pattern>
        <rect width={W} height={H} fill="url(#fleetGrid)" />

        {incidents.map((inc, i) => {
          const p = project({ lat: inc.lat, lng: inc.lng });
          return <circle key={`i${i}`} cx={p.x} cy={p.y} r="10" fill={inc.status === "blocked" ? "#C4306B" : "#E85D4C"} opacity="0.2" />;
        })}
        {incidents.map((inc, i) => {
          const p = project({ lat: inc.lat, lng: inc.lng });
          return <circle key={`ic${i}`} cx={p.x} cy={p.y} r="4" fill={inc.status === "blocked" ? "#C4306B" : "#E85D4C"} />;
        })}

        {vehicles.filter((v) => v.position).map((v) => {
          const p = project(v.position);
          const isSelected = v.shipmentId === selectedId;
          return (
            <g
              key={v.shipmentId}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(v)}
            >
              {isSelected && <circle r="12" fill={riskColor(v.riskScore)} opacity="0.25" className="animate-pulse-ring" />}
              <circle r="6" fill={riskColor(v.riskScore)} stroke="var(--color-base, #0B1220)" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
      <span className="absolute top-2 right-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint bg-base-panel/80 backdrop-blur px-2 py-1 rounded border border-base-border">
        Offline — DEMO Pan-India GIS projection
      </span>
    </div>
  );
}

export default function FleetMap({ vehicles = [], incidents = [], sosAlerts = [], inactivityAlerts = [], selected, onSelect, onRefresh }) {
  const { isOnline } = useMapsStatus();
  const { theme } = useTheme();
  const [tileUrl, setTileUrl] = useState(TILE_URL_OSM);

  const handleTileError = () => {
    if (tileUrl !== TILE_URL_ESRI) {
      setTileUrl(TILE_URL_ESRI);
    }
  };

  if (!isOnline) {
    return (
      <div>
        <DemoFleetMap vehicles={vehicles} incidents={incidents} onSelect={onSelect} selectedId={selected?.shipmentId || selected?.data?.id} />
        {selected && selected.type === "incident" ? (
          <IncidentInfoCard incident={selected.data} onRefresh={onRefresh} onSelect={onSelect} />
        ) : selected && !selected.type ? (
          <VehicleInfoCard vehicle={selected} />
        ) : null}
      </div>
    );
  }

  const vehiclePoints = vehicles.map((v) => v.position).filter(Boolean);
  const incidentPoints = incidents.map((i) => ({ lat: i.lat, lng: i.lng }));
  const sosPoints = sosAlerts.filter((s) => s.latitude && s.longitude).map((s) => ({ lat: s.latitude, lng: s.longitude }));
  const inactivityPoints = inactivityAlerts.filter((a) => a.latitude && a.longitude).map((a) => ({ lat: a.latitude, lng: a.longitude }));
  const fitPoints = [...vehiclePoints, ...incidentPoints, ...sosPoints, ...inactivityPoints, INDIA_CENTER];

  return (
    <div>
      <div className={`relative z-0 w-full rounded-lg overflow-hidden border border-base-border shadow-panel ${theme === 'dark' ? 'orion-dark-map' : 'orion-light-map'}`} style={{ height: 520 }}>
        <MapContainer
          center={[INDIA_CENTER.lat, INDIA_CENTER.lng]}
          zoom={5}
          minZoom={3}
          maxZoom={19}
          style={{ width: "100%", height: "100%", background: theme === "light" ? "#F4F6FA" : "#0F1930" }}
          zoomControl
          scrollWheelZoom
        >
          <TileLayer
            url={tileUrl}
            attribution={TILE_ATTRIBUTION}
            subdomains="abc"
            maxZoom={19}
            eventHandlers={{ tileerror: handleTileError }}
          />
          <FitBounds points={fitPoints} />

          {/* Active Danger Zone / Blocked Radius Circles */}
          {incidents.filter((inc) => inc.is_danger_zone || inc.status === "active" || inc.status === "blocked").map((inc, i) => (
            <Circle
              key={`circle-${i}`}
              center={[inc.lat, inc.lng]}
              radius={(inc.radius_km || 5) * 1000}
              pathOptions={{
                color: inc.status === "blocked" ? "#C4306B" : "#E85D4C",
                fillColor: inc.status === "blocked" ? "#C4306B" : "#E85D4C",
                fillOpacity: 0.18,
                weight: 2,
                dashArray: inc.status === "blocked" ? "6,6" : undefined,
              }}
            />
          ))}

          {/* Active 🚨 SOS Emergency Markers */}
          {sosAlerts.filter((sos) => sos.latitude && sos.longitude).map((sos, i) => (
            <Marker
              key={`sos-${sos.id || i}`}
              position={[sos.latitude, sos.longitude]}
              icon={sosMarkerIcon()}
            >
              <Popup>
                <div className="text-xs text-black space-y-1 font-mono p-1">
                  <p className="font-bold text-rose-600 text-sm flex items-center gap-1">
                    <span>🚨</span>
                    <span>OFFLINE SOS EMERGENCY</span>
                  </p>
                  <p><span className="font-bold">Type:</span> {sos.emergency_type || "Emergency"}</p>
                  <p><span className="font-bold">Driver:</span> {sos.driver_name} ({sos.driver_phone || "No phone"})</p>
                  <p><span className="font-bold">Vehicle:</span> {sos.vehicle_no}</p>
                  <p><span className="font-bold">Channel:</span> {sos.communication_provider || "Internet"}</p>
                  <p><span className="font-bold">Time:</span> {sos.created_at ? new Date(sos.created_at).toLocaleTimeString("en-IN") : "Just now"}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Driver Inactivity & Communication Loss Markers (LAST KNOWN LOCATION) */}
          {inactivityAlerts.filter((inact) => inact.latitude && inact.longitude).map((inact, i) => (
            <Marker
              key={`inact-${inact.id || i}`}
              position={[inact.latitude, inact.longitude]}
              icon={inactivityMarkerIcon(inact.alert_level)}
            >
              <Popup>
                <div className="text-xs text-black space-y-1 font-mono p-1">
                  <p className="font-bold text-amber-600 text-sm flex items-center gap-1">
                    <span>⚠️</span>
                    <span>LAST KNOWN LOCATION</span>
                  </p>
                  <p><span className="font-bold">Driver:</span> {inact.driver_name} ({inact.driver_phone || "No phone"})</p>
                  <p><span className="font-bold">Vehicle:</span> {inact.vehicle_no}</p>
                  <p><span className="font-bold">Status:</span> {inact.status?.replace(/_/g, " ")}</p>
                  <p><span className="font-bold">Offline Duration:</span> {Math.round(inact.offline_duration_minutes || 11)} minutes</p>
                  <p><span className="font-bold">Risk Score:</span> {inact.final_risk_score}/100</p>
                  <p className="text-[10px] text-gray-600 italic">Last updated: {inact.last_ping_at ? new Date(inact.last_ping_at).toLocaleTimeString("en-IN") : "10 min ago"}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Vehicle Markers */}
          {vehicles.filter((v) => v.position).map((v) => (
            <Marker
              key={v.shipmentId}
              position={[v.position.lat, v.position.lng]}
              icon={vehicleIcon(riskColor(v.riskScore), v.shipmentId === selected?.shipmentId)}
              eventHandlers={{ click: () => onSelect(v) }}
            >
              <Popup>
                <div className="text-xs text-black space-y-1">
                  <p className="font-bold">{v.driverName || "Driver"}</p>
                  <p>Vehicle: {v.registrationNo || "N/A"}</p>
                  <p>Shipment: {v.shipmentName || "N/A"}</p>
                  <p className="font-semibold text-rose-700">Risk Score: {v.riskScore}/100</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Incident / Hazard / Blocked Road Markers */}
          {incidents.map((inc, i) => (
            <Marker
              key={i}
              position={[inc.lat, inc.lng]}
              icon={incidentIcon(inc.status)}
              eventHandlers={{ click: () => onSelect({ type: "incident", data: inc }) }}
            >
              <Popup>
                <div className="text-xs text-black space-y-1">
                  <p className="font-bold capitalize">{inc.type ? inc.type.replace(/_/g, " ") : "Hazard"} ({inc.status.replace(/_/g, " ")})</p>
                  <p className="truncate max-w-[180px]">{inc.description || "No description provided"}</p>
                  <p className="text-[10px] text-gray-600">Coords: {inc.lat.toFixed(4)}°, {inc.lng.toFixed(4)}°</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {selected && selected.type === "incident" ? (
        <IncidentInfoCard incident={selected.data} onRefresh={onRefresh} onSelect={onSelect} />
      ) : selected && !selected.type ? (
        <VehicleInfoCard vehicle={selected} />
      ) : null}
    </div>
  );
}

function VehicleInfoCard({ vehicle }) {
  const riskBand = riskLevelFor(vehicle.riskScore || 0);

  return (
    <div className="panel p-4 mt-3 space-y-3">
      <div className="flex items-center justify-between border-b border-base-border pb-2">
        <div>
          <span className="text-xs font-mono text-ink-faint">Live Active Driver Marker</span>
          <h3 className="font-display font-semibold text-base text-ink">{vehicle.driverName || "Driver"}</h3>
        </div>
        <StatusBadge status={vehicle.status || "in_transit"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Field label="Driver" value={vehicle.driverName || "Arun"} />
        <Field label="Vehicle" value={vehicle.registrationNo || "TRUCK-102"} />
        <Field label="Shipment" value={vehicle.shipmentName || vehicle.goodsType || "Medicine #1024"} />
        <Field label="Destination" value={vehicle.destinationName || "Shillong"} />
        <Field label="Status" value={vehicle.status ? vehicle.status.replace(/_/g, " ") : "In Transit"} capitalize />
        <Field label="Speed" value={vehicle.speedKmh != null ? `${vehicle.speedKmh} km/h` : "42 km/h"} />
        <Field label="Last Update" value={vehicle.lastUpdated || "10 seconds ago"} />
        <Field label="Route Status" value={vehicle.routeStatus || "Active"} />
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-base-border text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">Risk Score:</span>
          <span className={`font-mono text-xs uppercase font-bold px-2 py-0.5 rounded border border-current/20 ${riskBand.color}`}>
            {riskBand.level} ({vehicle.riskScore || 0}/100)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">Weather:</span>
          <span className="font-mono text-xs text-ink">{vehicle.weather || "Clear"}</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, capitalize = false }) {
  return (
    <div>
      <p className="text-[10px] uppercase font-mono tracking-wide text-ink-faint">{label}</p>
      <p className={`text-ink text-sm truncate font-medium ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

function IncidentInfoCard({ incident, onRefresh, onSelect }) {
  const { user } = useAuth();
  const [marking, setMarking] = useState(false);
  const [radius, setRadius] = useState(5);
  const [viewImage, setViewImage] = useState(null);

  const handleMarkActive = async () => {
    setMarking(true);
    try {
      await markDangerZone(incident.id, { radiusKm: radius, reviewedBy: user?.id });
      if (onRefresh) await onRefresh();
      if (onSelect) {
        onSelect({ type: "incident", data: { ...incident, status: "active", is_danger_zone: true, radius_km: radius } });
      }
    } catch (err) {
      alert(err.message || "Failed to mark danger zone");
    } finally {
      setMarking(false);
    }
  };

  const isPending = incident.status === "pending_review";
  const isBlocked = incident.status === "blocked";

  return (
    <div className="panel p-4 mt-3 space-y-3">
      <div className="flex items-center justify-between border-b border-base-border pb-2">
        <div>
          <span className="text-xs font-mono text-ink-faint">Hazard Report Info</span>
          <h3 className="font-display font-semibold text-base text-ink capitalize">
            {incident.type ? incident.type.replace(/_/g, " ") : "Hazard Report"}
          </h3>
        </div>
        <span className={`text-xs font-mono font-bold uppercase px-2 py-0.5 rounded ${
          isBlocked ? "bg-risk-critical/20 text-risk-critical border border-risk-critical/30" : isPending ? "bg-risk-moderate/20 text-risk-moderate" : "bg-risk-veryhigh/20 text-risk-veryhigh"
        }`}>
          {incident.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {incident.image_url && (
          <div className="shrink-0 w-32 h-32 relative group">
            <img src={incident.image_url} alt="Hazard" className="w-full h-full object-cover rounded-lg border border-base-border" />
            <button
              onClick={() => setViewImage(incident.image_url)}
              className="absolute inset-0 bg-black/40 text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg"
            >
              Expand Image
            </button>
          </div>
        )}
        <div className="flex-1 space-y-2 text-sm">
          <p className="text-ink"><span className="text-ink-faint">Description:</span> {incident.description || "No description provided."}</p>
          <p className="text-xs text-ink-muted">Reported by: {incident.reporter?.full_name || "Field Driver"} · Location: {incident.lat.toFixed(4)}°, {incident.lng.toFixed(4)}°</p>
          
          {isPending && (
            <div className="flex items-center gap-2 pt-2">
              <label className="text-xs font-mono text-ink-muted">Radius:</label>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="bg-base-raised border border-base-border rounded px-2 py-1 text-xs font-mono text-ink"
              >
                <option value={2}>2 km</option>
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={15}>15 km</option>
              </select>
              <button
                onClick={handleMarkActive}
                disabled={marking}
                className="btn-primary text-xs px-3 py-1.5"
              >
                {marking ? "Marking..." : "Mark as Active Danger Zone"}
              </button>
            </div>
          )}
        </div>
      </div>

      {viewImage && (
        <div
          onClick={() => setViewImage(null)}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img src={viewImage} alt="Enlarged Hazard" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
            <p className="text-xs font-mono text-white/80 mt-2">Click anywhere to close full-size image</p>
          </div>
        </div>
      )}
    </div>
  );
}
