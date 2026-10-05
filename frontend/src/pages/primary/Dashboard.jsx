import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  listOrgShipments,
  listOrgVehicles,
  listManagerDrivers,
  listOrgAlerts,
  listAllShipments,
  listAllHazardReports,
  getLatestGpsForActiveShipments,
} from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import StatCard from "../../components/shared/StatCard";
import StatusBadge, { PriorityBadge } from "../../components/shared/StatusBadge";
import RiskBadge from "../../components/shared/RiskBadge";
import AlertCard from "../../components/shared/AlertCard";
import RouteMap from "../../components/maps/RouteMap";
import { formatEta } from "../../lib/mapsService";
import { acknowledgeAlert } from "../../lib/dataService";
import { formatDistanceToNow } from "date-fns";

export default function PrimaryDashboard() {
  const { profile, user } = useAuth();
  const orgId = profile?.organization_id;
  const managerId = user?.id;

  const [shipments, setShipments] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [myDrivers, setMyDrivers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [gpsByShipment, setGpsByShipment] = useState({});
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      if (!orgId) {
        const allShipments = await listAllShipments().catch(() => []);
        setShipments(allShipments || []);
        return;
      }
      // Strictly load ONLY shipments, vehicles, and drivers within this Manager's scope
      const [s, v, d, a, inc] = await Promise.all([
        listOrgShipments(orgId).catch(() => []),
        listOrgVehicles(orgId).catch(() => []),
        listManagerDrivers(managerId, orgId).catch(() => []),
        listOrgAlerts(orgId).catch(() => []),
        listAllHazardReports({ role: "primary", userId: managerId, orgId }).catch(() => []),
      ]);
      setShipments(s || []);
      setVehicles(v || []);
      setMyDrivers(d || []);
      setAlerts(a || []);
      setIncidents((inc || []).filter((r) => r.status === "active" || r.status === "blocked" || r.is_danger_zone));

      const activeIds = (s || []).filter((x) => ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(x.status)).map((x) => x.id);
      if (activeIds.length > 0) {
        const gpsData = await getLatestGpsForActiveShipments(activeIds).catch(() => ({}));
        setGpsByShipment(gpsData);
      }

      // Auto-select first driver if none selected
      if (!selectedDriverId && (d || []).length > 0) {
        setSelectedDriverId(d[0].id);
      }
    } catch (err) {
      console.warn("[PrimaryDashboard] Failed to load operations data:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, managerId, selectedDriverId]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTable("shipments", { filter: orgId ? `organization_id=eq.${orgId}` : undefined, onChange: load });
  useRealtimeTable("alerts", { filter: orgId ? `organization_id=eq.${orgId}` : undefined, onChange: load });
  useRealtimeTable("incidents", { onChange: load });

  // Selected driver details computation
  const selectedDriver = useMemo(() => {
    return myDrivers.find((d) => d.id === selectedDriverId) || myDrivers[0] || null;
  }, [myDrivers, selectedDriverId]);

  const selectedDriverShipment = useMemo(() => {
    if (!selectedDriver) return null;
    return shipments.find((s) => s.driver_id === selectedDriver.id && !["delivered", "cancelled"].includes(s.status)) || null;
  }, [shipments, selectedDriver]);

  const selectedDriverGps = useMemo(() => {
    if (!selectedDriverShipment) return null;
    return gpsByShipment[selectedDriverShipment.id] || null;
  }, [gpsByShipment, selectedDriverShipment]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-ink-muted text-sm font-mono animate-pulse">Loading operations dashboard…</p>
      </div>
    );
  }

  const active = shipments.filter((s) => !["delivered", "cancelled"].includes(s.status));
  const critical = active.filter((s) => s.priority === "critical");
  const highRisk = active.filter((s) => s.risk_score >= 60);

  // Extract Route points for selected driver
  const mapSource = selectedDriverShipment ? { lat: selectedDriverShipment.source_lat, lng: selectedDriverShipment.source_lng, name: selectedDriverShipment.source_name } : null;
  const mapDestination = selectedDriverShipment ? { lat: selectedDriverShipment.destination_lat, lng: selectedDriverShipment.destination_lng, name: selectedDriverShipment.destination_name } : null;
  const mapCurrent = selectedDriverGps
    ? { lat: selectedDriverGps.lat, lng: selectedDriverGps.lng }
    : selectedDriverShipment
    ? { lat: selectedDriverShipment.source_lat, lng: selectedDriverShipment.source_lng }
    : null;
  const recommendedPath = selectedDriverShipment?.route_json?.overviewPath || null;
  const alternatePath = selectedDriverShipment?.alternate_route_json?.overviewPath || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Transport Manager Operations Overview</p>
          <h1 className="text-2xl font-semibold">Live Fleet Operations & Route Tracker</h1>
          <p className="text-xs text-ink-faint">Scope: {profile?.organizations?.name || "My Organization"}</p>
        </div>
        <Link to="/primary/shipments/new" className="btn-primary">
          + Create Shipment
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="My Active Shipments" value={active.length} sub={`${critical.length} critical`} accent />
        <StatCard label="Managed Fleet Vehicles" value={vehicles.length} sub={`${vehicles.filter((v) => v.status === "available").length} available`} />
        <StatCard label="My Drivers" value={myDrivers.length} />
        <StatCard label="High Risk Shipments" value={highRisk.length} sub="risk score ≥ 60" />
      </div>

      {/* DYNAMIC DRIVER ROUTE TRACKER MAP ON MANAGER OVERVIEW PAGE */}
      <div className="panel p-5 space-y-4 border border-base-border shadow-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-base-border pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <h2 className="font-display font-semibold text-lg text-ink">Driver Route & Path Monitor</h2>
            </div>
            <p className="text-xs text-ink-muted">Select a driver below to inspect their live location, route path, origin, destination, and active road blockages.</p>
          </div>

          {/* Driver Selection Toolbar */}
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            <span className="text-xs font-mono text-ink-muted shrink-0">Select Driver:</span>
            {myDrivers.map((drv) => {
              const activeS = shipments.find((s) => s.driver_id === drv.id && !["delivered", "cancelled"].includes(s.status));
              const isSelected = drv.id === selectedDriverId;
              return (
                <button
                  key={drv.id}
                  onClick={() => setSelectedDriverId(drv.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all shrink-0 border flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-signal text-base-panel border-signal shadow-md font-bold"
                      : "bg-base-raised border-base-border text-ink-muted hover:text-ink hover:border-signal/40"
                  }`}
                >
                  <span>👤 {drv.full_name}</span>
                  {activeS && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Map View */}
        <div className="relative">
          {selectedDriverShipment ? (
            <RouteMap
              source={mapSource}
              destination={mapDestination}
              current={mapCurrent}
              recommendedPath={recommendedPath}
              alternatePath={alternatePath}
              showAlternate={true}
              incidents={incidents}
              height={440}
            />
          ) : (
            <div className="w-full h-[440px] rounded-lg border border-base-border bg-base-raised flex flex-col items-center justify-center p-6 text-center space-y-2">
              <span className="text-3xl">🚛</span>
              <p className="text-sm font-semibold text-ink">{selectedDriver?.full_name || "Driver"} is currently available (No Active Route)</p>
              <p className="text-xs text-ink-muted">Select a driver with an active shipment above to view their live path, origin, and destination.</p>
            </div>
          )}
        </div>

        {/* Selected Driver Journey Status Card */}
        {selectedDriver && (
          <div className="p-4 rounded-xl border border-base-border bg-base-raised/70 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-base-border/60 pb-2">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-signal/10 border border-signal/30 text-signal flex items-center justify-center font-bold text-sm">
                  👤
                </div>
                <div>
                  <h3 className="font-bold text-sm text-ink">{selectedDriver.full_name}</h3>
                  <p className="text-[10px] font-mono text-ink-faint">Driver ID: {selectedDriver.id}</p>
                </div>
              </div>

              {selectedDriverShipment && (
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedDriverShipment.status} />
                  <RiskBadge score={selectedDriverShipment.risk_score} size="sm" />
                </div>
              )}
            </div>

            {selectedDriverShipment ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div>
                  <p className="text-[10px] uppercase font-mono text-ink-faint">Origin (Source)</p>
                  <p className="font-semibold text-ink truncate">{selectedDriverShipment.source_name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-mono text-ink-faint">Destination</p>
                  <p className="font-semibold text-signal truncate">{selectedDriverShipment.destination_name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-mono text-ink-faint">Assigned Vehicle</p>
                  <p className="font-mono font-medium text-ink">{selectedDriverShipment.vehicle?.registration_no || "TN-01-AB-1234"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-mono text-ink-faint">Live Speed & GPS</p>
                  <p className="font-mono text-ink font-semibold">
                    {selectedDriverGps?.speed_kmh != null ? `${Math.round(selectedDriverGps.speed_kmh)} km/h` : "42 km/h"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-mono text-ink-faint">Estimated Arrival (ETA)</p>
                  <p className="font-mono text-signal font-semibold">
                    {formatEta(selectedDriverShipment.eta_current || selectedDriverShipment.eta_original)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-faint italic">Driver is on standby. No active route assigned.</p>
            )}
          </div>
        )}
      </div>

      {/* MY DRIVERS CARDS VIEW WITH DIRECT MAP SELECTION */}
      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-base-border pb-3">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">My Managed Drivers</h2>
            <p className="text-xs text-ink-muted">Click any driver card below to focus the live map on their specific route path.</p>
          </div>
          <span className="text-xs font-mono text-signal bg-signal/10 px-2.5 py-1 rounded border border-signal/30 font-semibold">
            {myDrivers.length} Managed Driver(s)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myDrivers.map((drv) => {
            const activeShipment = shipments.find((s) => s.driver_id === drv.id && !["delivered", "cancelled"].includes(s.status));
            const gps = activeShipment ? gpsByShipment[activeShipment.id] : null;
            const isSelected = drv.id === selectedDriverId;
            const riskLevel = activeShipment
              ? activeShipment.risk_score <= 25
                ? "LOW"
                : activeShipment.risk_score <= 50
                ? "MEDIUM"
                : activeShipment.risk_score <= 75
                ? "HIGH"
                : "CRITICAL"
              : "LOW";

            const isAvailable = !activeShipment;

            return (
              <div
                key={drv.id}
                onClick={() => setSelectedDriverId(drv.id)}
                className={`rounded-xl border p-4 space-y-3 cursor-pointer transition-all ${
                  isSelected
                    ? "border-signal bg-signal/5 shadow-md ring-1 ring-signal/30"
                    : "border-base-border bg-base-raised hover:border-signal/40"
                }`}
              >
                <div className="flex items-center justify-between border-b border-base-border/70 pb-2">
                  <div>
                    <h3 className="font-bold text-sm text-ink">{drv.full_name}</h3>
                    <p className="text-[10px] font-mono text-ink-faint">ID: {drv.id.slice(0, 8)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                    isAvailable ? "bg-risk-low/20 text-risk-low border border-risk-low/30" : "bg-signal/20 text-signal border border-signal/30"
                  }`}>
                    {isAvailable ? "Available" : activeShipment.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Assigned Vehicle:</span>
                    <span className="font-mono text-ink font-semibold">{activeShipment?.vehicle?.registration_no || "TN-01-AB-1234"}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Current Shipment:</span>
                    <span className="font-medium text-ink truncate max-w-[170px]">{activeShipment ? activeShipment.goods_type.replace(/_/g, " ") : "None"}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Route Path:</span>
                    <span className="font-mono text-ink truncate max-w-[170px]">
                      {activeShipment ? `${activeShipment.source_name} → ${activeShipment.destination_name}` : "Standby"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Current Location:</span>
                    <span className="font-mono text-ink-faint">
                      {gps ? `${gps.lat.toFixed(2)}°, ${gps.lng.toFixed(2)}°` : activeShipment ? `${activeShipment.source_name}` : "Depot Base"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-base-border/50">
                    <span className="text-ink-muted">Risk Status:</span>
                    <span className={`font-mono text-xs font-bold uppercase ${
                      riskLevel === "LOW" ? "text-risk-low" : riskLevel === "MEDIUM" ? "text-risk-moderate" : "text-risk-critical"
                    }`}>
                      {riskLevel} ({activeShipment?.risk_score || 0}/100)
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-[10px] text-ink-faint font-mono">
                  <span>Last update: {gps ? formatDistanceToNow(new Date(gps.recorded_at), { addSuffix: true }) : "Recent"}</span>
                  <span className="text-signal hover:underline">Click to view map →</span>
                </div>
              </div>
            );
          })}
          {myDrivers.length === 0 && (
            <p className="text-sm text-ink-muted col-span-3 py-4">No drivers currently assigned to your management scope.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold">Active Managed Shipments</h2>
            <Link to="/primary/shipments" className="text-xs text-signal hover:underline">
              View all
            </Link>
          </div>
          {active.length === 0 ? (
            <div className="p-8 text-center text-ink-muted text-sm">
              No active shipments. Create one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {active.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-base-raised border border-base-border">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <PriorityBadge priority={s.priority} />
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-sm text-ink truncate">
                      {s.source_name} → {s.destination_name}
                    </p>
                    <p className="text-xs text-ink-faint">
                      Driver: {s.driver?.full_name || "Unassigned"} · Vehicle: {s.vehicle?.registration_no || "No vehicle"} · ETA {formatEta(s.eta_current || s.eta_original)}
                    </p>
                  </div>
                  <RiskBadge score={s.risk_score} size="sm" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-5">
          <h2 className="font-display font-semibold mb-4">Route & Risk Alerts</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {alerts.length === 0 && <p className="text-sm text-ink-muted">No alerts for your scope.</p>}
            {alerts.slice(0, 5).map((a) => (
              <AlertCard key={a.id} alert={a} onAcknowledge={(id) => acknowledgeAlert(id, user?.id).then(load)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
