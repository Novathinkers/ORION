import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { listDriverShipments, updateShipment, getActiveIncidents, getLatestWeather, getActiveRoadIssues, insertRiskHistory, setUserPhoto } from "../../lib/dataService";
import { uploadHazardImage } from "../../lib/imageAnalysisService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import { useGeolocation } from "../../hooks/useGeolocation";
import { useOfflineQueue } from "../../hooks/useOfflineQueue";
import RouteMap from "../../components/maps/RouteMap";
import RiskBadge from "../../components/shared/RiskBadge";
import StatusBadge, { PriorityBadge, ConnectivityBadge } from "../../components/shared/StatusBadge";
import { formatEta, routeProgress } from "../../lib/mapsService";
import { computeRisk, computeEta, getVehicleBaseSpeed } from "../../lib/riskEngine";
import { simulateGpsTick, createAlert } from "../../lib/demoSimulator";
import SOSButton from "../../components/sos/SOSButton";
import SOSStatusCard from "../../components/sos/SOSStatusCard";
import { useDriverHeartbeat } from "../../hooks/useDriverHeartbeat";
const DEVIATION_THRESHOLD_KM = 6;
const SIM_TICK_MS = 2500;

export default function DriverDashboard() {
  const { profile, user, refreshProfile } = useAuth();
  const fileInputRef = useRef(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    setPhotoError("");
    try {
      const publicUrl = await uploadHazardImage(file, { userId: user.id });
      await setUserPhoto(user.id, publicUrl);
      if (refreshProfile) {
        await refreshProfile();
      }
    } catch (err) {
      setPhotoError(err.message || "Failed to upload photo");
    } finally {
      setPhotoLoading(false);
    }
  };

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null); // {lat,lng}
  const [simActive, setSimActive] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [environment, setEnvironment] = useState({ weather: [], road: [], incidents: [] });
  const simIntervalRef = useRef(null);
  const lastRecalcRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const s = await listDriverShipments(user.id).catch(() => []);
      setShipments(s || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[DriverDashboard] Failed to load driver journey:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("shipments", { filter: `driver_id=eq.${user?.id}`, onChange: load, enabled: !!user });

  const shipment = shipments[0] || null;

  const loadEnvironment = useCallback(async () => {
    const [weather, road, incidents] = await Promise.all([getLatestWeather(), getActiveRoadIssues(), getActiveIncidents()]);
    setEnvironment({ weather, road, incidents });
  }, []);
  useEffect(() => { loadEnvironment(); const t = setInterval(loadEnvironment, 15000); return () => clearInterval(t); }, [loadEnvironment]);
  useRealtimeTable("road_conditions", { onChange: loadEnvironment });
  useRealtimeTable("incidents", { onChange: loadEnvironment });

  const { enqueue, connectivity } = useOfflineQueue({ shipmentId: shipment?.id, driverId: user?.id });
  useDriverHeartbeat({ shipment, activeDangerZones: environment.incidents });

  const recalc = useCallback(
    async (point) => {
      if (!shipment || !shipment.route_json) return;
      const now = Date.now();
      if (now - lastRecalcRef.current < 4000) return; // throttle recalculation
      lastRecalcRef.current = now;

      const path = shipment.route_json.overviewPath;
      const { t, deviationKm } = routeProgress(path, point);
      const remainingKm = shipment.distance_km * (1 - t);

      const latestWeather = environment.weather[0];
      const nearestRoad = environment.road[0];
      const risk = computeRisk({
        weather: latestWeather ? { condition: latestWeather.condition, rainfall_mm: latestWeather.rainfall_mm } : null,
        nearbyIncidents: environment.incidents.map((i) => ({ type: i.type, severity: i.severity })),
        roadStatus: nearestRoad?.status || null,
        priority: shipment.priority,
        routeDeviationKm: deviationKm,
        terrain: "hill",
      });

      const { minutes, adjustedSpeedKmh } = computeEta({
        remainingKm: Math.max(0, remainingKm),
        vehicleType: shipment.vehicle?.vehicle_type,
        weather: latestWeather ? { condition: latestWeather.condition } : null,
        roadStatus: nearestRoad?.status || null,
      });
      const etaCurrent = new Date(Date.now() + minutes * 60000);

      const deviated = deviationKm > DEVIATION_THRESHOLD_KM;
      const nextStatus = deviated ? "rerouting" : shipment.status === "rerouting" ? "in_transit" : shipment.status;

      await updateShipment(shipment.id, {
        risk_score: risk.score,
        risk_level: risk.level,
        risk_explanation: risk.explanation,
        eta_current: etaCurrent.toISOString(),
        status: nextStatus,
      });
      await insertRiskHistory({ shipmentId: shipment.id, score: risk.score, factors: risk.factors, explanation: risk.explanation });

      if (deviated) {
        await createAlert({
          shipmentId: shipment.id,
          organizationId: shipment.organization_id,
          type: "deviation",
          what: `Driver is ${deviationKm.toFixed(1)}km off the planned route`,
          whereText: `Near ${shipment.source_name} → ${shipment.destination_name} corridor`,
          severity: "high",
          recommendedAction: "Contact driver and confirm reason for deviation; re-evaluate route if needed.",
        });
      }
    },
    [shipment, environment]
  );

  const geo = useGeolocation({
    onUpdate: (pos) => {
      setCurrent({ lat: pos.lat, lng: pos.lng });
      if (!shipment) return;
      enqueue({ lat: pos.lat, lng: pos.lng, speedKmh: pos.speedKmh, heading: pos.heading, accuracyM: pos.accuracyM, source: "real" });
      recalc({ lat: pos.lat, lng: pos.lng });
    },
  });

  // Automatically start live GPS tracking on mount
  useEffect(() => {
    geo.requestOnce().catch(() => {});
    geo.start();
    return () => {
      geo.stop();
      clearInterval(simIntervalRef.current);
    };
  }, []); // eslint-disable-line

  const startJourney = async () => {
    if (!shipment) return;
    try {
      await geo.requestOnce();
    } catch {
      // fallback
    }
    geo.start();
    await updateShipment(shipment.id, { status: "in_transit", started_at: new Date().toISOString() });
    await load();
  };

  const startSimulatedJourney = async () => {
    if (!shipment) return;
    if (shipment.status === "assigned" || shipment.status === "ready_to_start") {
      await updateShipment(shipment.id, { status: "in_transit", started_at: new Date().toISOString() });
      await load();
    }
    setSimActive(true);
    let progress = simProgress;
    simIntervalRef.current = setInterval(async () => {
      const path = shipment.route_json?.overviewPath;
      if (!path) return;
      const result = await simulateGpsTick({ shipmentId: shipment.id, driverId: user.id, path, progress, step: 0.015 });
      progress = result.progress;
      setSimProgress(progress);
      if (result.point) {
        setCurrent(result.point);
        recalc(result.point);
      }
      if (progress >= 1) {
        clearInterval(simIntervalRef.current);
        setSimActive(false);
      }
    }, SIM_TICK_MS);
  };

  const stopSimulation = () => {
    clearInterval(simIntervalRef.current);
    setSimActive(false);
  };

  useEffect(() => () => { geo.stop(); clearInterval(simIntervalRef.current); }, []); // eslint-disable-line

  const markArrived = async () => {
    await updateShipment(shipment.id, { status: "arrived" });
    await load();
  };

  const markDelivered = async () => {
    geo.stop();
    stopSimulation();
    await updateShipment(shipment.id, { status: "delivered", delivered_at: new Date().toISOString() });
    await load();
  };

  if (loading) return <p className="text-ink-muted text-sm font-mono">Loading your journey…</p>;

  const profileWidget = (
    <div className="panel p-4 flex items-center justify-between bg-base-panel border border-base-border rounded-lg">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full overflow-hidden bg-base-border border border-base-border flex items-center justify-center shrink-0">
          {profile?.photo_url ? (
            <img src={profile.photo_url} alt="Profile" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl">👤</span>
          )}
        </div>
        <div>
          <p className="font-semibold text-sm text-ink">{profile?.full_name}</p>
          <p className="text-xs text-ink-muted">Driver · {profile?.phone || "No phone on file"}</p>
        </div>
      </div>
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={photoLoading}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          {photoLoading ? "Uploading..." : "Upload Photo"}
        </button>
        {photoError && <p className="text-xs text-risk-veryhigh mt-1">{photoError}</p>}
      </div>
    </div>
  );

  if (!shipment) {
    return (
      <div className="max-w-xl space-y-5">
        {profileWidget}
        <SOSButton />
        <SOSStatusCard />
        <div className="panel p-5">
          <h1 className="text-2xl font-semibold mb-2">No active shipment</h1>
          <p className="text-sm text-ink-muted">You'll see your assigned shipment here once your transport manager assigns one to you.</p>
        </div>
      </div>
    );
  }

  const preTransit = shipment.status === "assigned" || shipment.status === "ready_to_start";
  const inTransit = ["in_transit", "delayed", "rerouting"].includes(shipment.status);
  const arrived = shipment.status === "arrived";

  return (
    <div className="space-y-5">
      {profileWidget}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <PriorityBadge priority={shipment.priority} />
            <StatusBadge status={shipment.status} />
            <ConnectivityBadge status={connectivity} />
          </div>
          <h1 className="text-2xl font-semibold">{shipment.source_name} → {shipment.destination_name}</h1>
          <p className="text-sm text-ink-muted capitalize">{shipment.goods_type.replace(/_/g, " ")} · {shipment.vehicle?.registration_no}</p>
        </div>
        <RiskBadge score={shipment.risk_score} />
      </div>
      {/* Prominent Offline SOS Emergency Card & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SOSButton shipment={shipment} vehicle={shipment?.vehicle} />
        </div>
        <div>
          <SOSStatusCard />
        </div>
      </div>

      <div className="panel p-3">
        <RouteMap
          source={{ lat: shipment.source_lat, lng: shipment.source_lng }}
          destination={{ lat: shipment.destination_lat, lng: shipment.destination_lng }}
          current={current}
          recommendedPath={shipment.route_json?.overviewPath}
          alternatePath={shipment.alternate_route_json?.overviewPath}
          incidents={environment.incidents}
          height={360}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="ETA" value={formatEta(shipment.eta_current || shipment.eta_original)} />
        <MiniStat label="Vehicle / Speed" value={`${shipment.vehicle?.vehicle_type || "Truck"} (${getVehicleBaseSpeed(shipment.vehicle?.vehicle_type)} km/h)`} />
        <MiniStat label="Distance" value={shipment.distance_km ? `${shipment.distance_km.toFixed(0)} km` : "—"} />
        <MiniStat label="Weather / Road" value={`${environment.weather[0]?.condition?.replace("_", " ") || "Clear"} / ${environment.road[0]?.status?.replace("_", " ") || "Open"}`} />
      </div>

      <div className="p-3 bg-base-raised rounded-lg border border-base-border flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${geo.isTracking ? "bg-signal animate-pulse" : "bg-risk-moderate"}`} />
          <span className="font-bold text-ink">
            {geo.isTracking
              ? `LIVE GPS POSITION: ${current ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}` : "Acquiring satellites…"}`
              : "GPS Inactive — Tap Start Journey"}
          </span>
        </div>
        {geo.position?.accuracyM && (
          <span className="text-ink-faint text-[10px]">±{Math.round(geo.position.accuracyM)}m accuracy</span>
        )}
      </div>

      {geo.error && (
        <p className="text-xs text-risk-moderate">GPS Note: {geo.error} — Real location will connect once browser location permission is allowed.</p>
      )}

      <div className="panel p-5 space-y-3">
        {preTransit && (
          <>
            <button onClick={startJourney} className="btn-primary w-full text-base py-3.5">
              ▶ START JOURNEY (Real GPS)
            </button>
            <button onClick={startSimulatedJourney} className="btn-secondary w-full">
              Simulate GPS Instead (Demo)
            </button>
          </>
        )}

        {inTransit && (
          <>
            {simActive ? (
              <button onClick={stopSimulation} className="btn-secondary w-full">Stop Simulated GPS</button>
            ) : !geo.isTracking ? (
              <button onClick={startSimulatedJourney} className="btn-secondary w-full">Resume with Simulated GPS</button>
            ) : (
              <p className="text-xs text-signal font-mono text-center">● Live GPS tracking active</p>
            )}
            <button onClick={markArrived} className="btn-secondary w-full">Mark as Arrived at Destination</button>
          </>
        )}

        {arrived && (
          <button onClick={markDelivered} className="btn-primary w-full text-base py-3.5">
            ✓ MARK DELIVERY COMPLETE
          </button>
        )}

        {shipment.status === "delivered" && (
          <p className="text-center text-risk-low font-medium">Delivered. Thank you.</p>
        )}
      </div>

      {shipment.risk_explanation && (
        <div className="panel p-4">
          <p className="eyebrow mb-2">Risk Explanation</p>
          <p className="text-sm text-ink-muted">{shipment.risk_explanation}</p>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="panel p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">{label}</p>
      <p className="text-sm font-mono text-ink capitalize truncate">{value}</p>
    </div>
  );
}
