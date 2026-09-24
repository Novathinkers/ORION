import { MapContainer, TileLayer, Polyline, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { useMapsStatus } from "./MapProvider";
import { useTheme } from "../../contexts/ThemeContext";

// Free, no-key OpenStreetMap basemap tiles (No API key needed, NO watermark)
const TILE_URL_OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_URL_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function labelIcon(color, text) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${color};border:2px solid #0B1220;color:#0B1220;font:bold 11px monospace;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${text}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function dotIcon(color, size = 16, pulse = false) {
  const pulseRing = pulse
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;background:${color};opacity:0.35;" class="animate-pulse-ring"></div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size}px;">${pulseRing}<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #0B1220;box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    const valid = (points || []).filter(Boolean);
    if (valid.length === 0) return;
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], 9);
      return;
    }
    const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [35, 35] });
  }, [points, map]);
  return null;
}

function useProjection(points, width, height, padding = 40) {
  return useMemo(() => {
    const valid = points.filter(Boolean);
    if (valid.length === 0) return null;
    const lats = valid.map((p) => p.lat);
    const lngs = valid.map((p) => p.lng);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    if (minLat === maxLat) { minLat -= 0.05; maxLat += 0.05; }
    if (minLng === maxLng) { minLng -= 0.05; maxLng += 0.05; }
    const project = (p) => {
      const x = padding + ((p.lng - minLng) / (maxLng - minLng)) * (width - padding * 2);
      const y = height - padding - ((p.lat - minLat) / (maxLat - minLat)) * (height - padding * 2);
      return { x, y };
    };
    return project;
  }, [points, width, height, padding]);
}

function DemoFallbackMap({ source, destination, current, recommendedPath, alternatePath, showAlternate, incidents, height }) {
  const W = 800, H = height || 420;
  const allPoints = [source, destination, current, ...(recommendedPath || []), ...(alternatePath || []), ...(incidents || [])];
  const project = useProjection(allPoints, W, H);

  if (!project) {
    return (
      <div className="w-full flex items-center justify-center text-ink-faint text-sm border border-base-border rounded-lg" style={{ height: H }}>
        Waiting for route data…
      </div>
    );
  }

  const toSvgPath = (pts) => (pts || []).map(project).map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-base-border shadow-panel" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--color-base-border, #1A2438)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="var(--color-base-panel, #0F1930)" />
        <rect width={W} height={H} fill="url(#grid)" />

        {alternatePath && showAlternate && (
          <polyline points={toSvgPath(alternatePath)} fill="none" stroke="#5A6685" strokeWidth="2.5" strokeDasharray="6 5" />
        )}
        {recommendedPath && (
          <polyline points={toSvgPath(recommendedPath)} fill="none" stroke="#EF4444" strokeWidth="4" strokeLinecap="round" />
        )}

        {(incidents || []).map((inc, i) => {
          const p = project(inc);
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="9" fill={inc.status === "blocked" ? "#C4306B" : "#E85D4C"} opacity="0.25" />
              <circle cx={p.x} cy={p.y} r="4" fill={inc.status === "blocked" ? "#C4306B" : "#E85D4C"} />
            </g>
          );
        })}

        {source && (
          <g transform={`translate(${project(source).x}, ${project(source).y})`}>
            <circle r="6" fill="#3FBF7F" stroke="#0B1220" strokeWidth="2" />
            <text x="10" y="4" fontSize="11" fill="var(--color-ink, #E8ECF4)" fontFamily="monospace">SRC</text>
          </g>
        )}
        {destination && (
          <g transform={`translate(${project(destination).x}, ${project(destination).y})`}>
            <circle r="6" fill="#C4306B" stroke="#0B1220" strokeWidth="2" />
            <text x="10" y="4" fontSize="11" fill="var(--color-ink, #E8ECF4)" fontFamily="monospace">DEST</text>
          </g>
        )}
        {current && (
          <g transform={`translate(${project(current).x}, ${project(current).y})`}>
            <circle r="10" fill="#2FD9C4" opacity="0.25" className="animate-pulse-ring" />
            <circle r="5" fill="#2FD9C4" stroke="#0B1220" strokeWidth="2" />
          </g>
        )}
      </svg>
      <span className="absolute top-2 right-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint bg-base-panel/80 backdrop-blur px-2 py-1 rounded border border-base-border">
        Offline — DEMO map projection
      </span>
    </div>
  );
}

export default function RouteMap({
  source,
  destination,
  current,
  recommendedPath,
  alternatePath,
  showAlternate = true,
  incidents = [],
  height = 420,
}) {
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
      <DemoFallbackMap
        source={source}
        destination={destination}
        current={current}
        recommendedPath={recommendedPath}
        alternatePath={alternatePath}
        showAlternate={showAlternate}
        incidents={incidents}
        height={height}
      />
    );
  }

  const center = current || source || destination || { lat: 26.2, lng: 92.9 };
  const allPoints = [source, destination, current, ...(recommendedPath || []), ...(alternatePath || [])];

  return (
    <div className={`relative z-0 w-full rounded-lg overflow-hidden border border-base-border shadow-panel ${theme === 'dark' ? 'orion-dark-map' : 'orion-light-map'}`} style={{ height }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={8}
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
        <FitBounds points={allPoints} />

        {/* Highlighted Blocked Hazard Circles along route */}
        {incidents.filter((inc) => inc.status === "blocked" || inc.is_danger_zone).map((inc, i) => (
          <Circle
            key={`inc-c-${i}`}
            center={[inc.lat, inc.lng]}
            radius={(inc.radius_km || 5) * 1000}
            pathOptions={{ color: "#C4306B", fillColor: "#C4306B", fillOpacity: 0.2, weight: 2, dashArray: "6,6" }}
          />
        ))}

        {alternatePath && showAlternate && (
          <Polyline
            positions={alternatePath.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#64748B", weight: 3, opacity: 0.75, dashArray: "6 6" }}
          />
        )}
        {recommendedPath && (
          <Polyline
            positions={recommendedPath.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#EF4444", weight: 5, opacity: 0.95 }}
          />
        )}

        {source && (
          <Marker position={[source.lat, source.lng]} icon={labelIcon("#10B981", "S")}>
            <Popup><div className="text-xs text-black font-semibold">Source: {source.name || "Origin"}</div></Popup>
          </Marker>
        )}
        {destination && (
          <Marker position={[destination.lat, destination.lng]} icon={labelIcon("#EF4444", "D")}>
            <Popup><div className="text-xs text-black font-semibold">Destination: {destination.name || "Destination"}</div></Popup>
          </Marker>
        )}
        {current && <Marker position={[current.lat, current.lng]} icon={dotIcon("#EF4444", 16, true)} />}

        {incidents.map((inc, i) => (
          <Marker key={i} position={[inc.lat, inc.lng]} icon={dotIcon(inc.status === "blocked" ? "#C4306B" : "#E85D4C", 14)}>
            <Popup>
              <div className="text-xs text-black">
                <p className="font-bold capitalize">{inc.type}: {inc.status}</p>
                <p>{inc.description}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
