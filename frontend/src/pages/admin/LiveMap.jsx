import { useEffect, useState, useCallback } from "react";
import { listAllShipments, listAllHazardReports, getLatestGpsForActiveShipments } from "../../lib/dataService";
import { listActiveSosAlerts } from "../../lib/sosService";
import { listInactivityAlerts } from "../../lib/inactivityService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import FleetMap from "../../components/maps/FleetMap";
import { formatDistanceToNow } from "date-fns";

export default function LiveMap() {
  const [shipments, setShipments] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [sosAlerts, setSosAlerts] = useState([]);
  const [inactivityAlerts, setInactivityAlerts] = useState([]);
  const [gpsByShipment, setGpsByShipment] = useState({});
  const [selected, setSelected] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState("all");

  const load = useCallback(async () => {
    const s = await listAllShipments();
    setShipments(s);
    const reports = await listAllHazardReports();
    setIncidents(reports.filter((r) => r.status === "active" || r.status === "pending_review" || r.status === "blocked" || r.is_danger_zone));
    const sos = await listActiveSosAlerts().catch(() => []);
    setSosAlerts(sos || []);
    const inact = await listInactivityAlerts().catch(() => []);
    setInactivityAlerts(inact || []);
    const activeIds = s.filter((x) => ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(x.status)).map((x) => x.id);
    setGpsByShipment(await getLatestGpsForActiveShipments(activeIds));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("gps_locations", { onChange: load });
  useRealtimeTable("shipments", { onChange: load });
  useRealtimeTable("incidents", { onChange: load });
  useRealtimeTable("sos_alerts", { onChange: load });
  useRealtimeTable("driver_connectivity_alerts", { onChange: load });

  const activeVehicles = shipments
    .filter((s) => ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(s.status))
    .filter((s) => priorityFilter === "all" || s.priority === priorityFilter)
    .map((s) => {
      const gps = gpsByShipment[s.id];
      return {
        shipmentId: s.id,
        position: gps ? { lat: gps.lat, lng: gps.lng } : { lat: s.source_lat, lng: s.source_lng },
        riskScore: s.risk_score,
        status: s.status,
        driverName: s.driver?.full_name || "Arun",
        registrationNo: s.vehicle?.registration_no || "TRUCK-102",
        shipmentName: `${s.goods_type.replace(/_/g, " ")} #${s.id.slice(0, 5)}`,
        goodsType: s.goods_type,
        orgName: s.organization?.name,
        sourceName: s.source_name,
        destinationName: s.destination_name,
        speedKmh: gps?.speed_kmh != null ? Math.round(gps.speed_kmh) : 42,
        etaText: s.eta_current ? new Date(s.eta_current).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—",
        lastUpdated: gps ? formatDistanceToNow(new Date(gps.recorded_at), { addSuffix: true }) : "10 seconds ago",
        weather: s.risk_score > 50 ? "Heavy Rain" : "Clear",
        routeStatus: s.status === "rerouting" ? "Rerouting Recommended" : "Active",
      };
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Live Regional Fleet Map</h1>
          <p className="text-sm text-ink-muted">Real-time driver location updates via Supabase Realtime</p>
        </div>
        <div className="flex gap-2">
          {["all", "normal", "high", "critical"].map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize ${
                priorityFilter === p ? "bg-signal/10 text-signal border-signal/40" : "border-base-border text-ink-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {sosAlerts.length > 0 && (
        <div className="p-3 rounded-lg border border-risk-veryhigh/60 bg-risk-veryhigh/10 text-risk-veryhigh text-xs font-mono font-bold flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base animate-pulse">🚨</span>
            <span>{sosAlerts.length} Active SOS Emergency Alert(s) Broadcasted on Corridor</span>
          </div>
          <button onClick={() => window.location.href = "/admin/sos"} className="px-2.5 py-1 rounded bg-risk-veryhigh text-white font-bold hover:bg-risk-critical">
            OPEN SOS CENTER ➔
          </button>
        </div>
      )}
      <FleetMap vehicles={activeVehicles} incidents={incidents} sosAlerts={sosAlerts} inactivityAlerts={inactivityAlerts} selected={selected} onSelect={setSelected} onRefresh={load} />
    </div>
  );
}
