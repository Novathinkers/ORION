import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  getShipment, getLatestGpsForShipment, updateShipment, insertRiskHistory, getRiskHistory,
} from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import RouteMap from "../../components/maps/RouteMap";
import StatusBadge, { PriorityBadge } from "../../components/shared/StatusBadge";
import RiskBadge from "../../components/shared/RiskBadge";
import { formatEta, formatDuration } from "../../lib/mapsService";
import { computeRisk } from "../../lib/riskEngine";
import { evaluateAiMl } from "../../lib/aiMlEngine";
import { getPointWeather, conditionLabel } from "../../lib/weatherService";
import { getHazardScore } from "../../lib/hazardService";
import { simulateWeatherEvent, simulateRoadEvent, createAlert } from "../../lib/demoSimulator";
import { useAuth } from "../../contexts/AuthContext";
import CallDriverModal from "../../components/shared/CallDriverModal";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

export default function ShipmentDetail() {
  const { id } = useParams();
  const [shipment, setShipment] = useState(null);
  const [gps, setGps] = useState(null);
  const [riskHistory, setRiskHistory] = useState([]);
  const [simulating, setSimulating] = useState(false);
  const [liveConditions, setLiveConditions] = useState(null);
  const [checkingLive, setCheckingLive] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [callSuccessMessage, setCallSuccessMessage] = useState(false);
  const { profile } = useAuth();

  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const s = await getShipment(id);
      setShipment(s);
      const g = await getLatestGpsForShipment(id).catch(() => null);
      setGps(g);
      const rh = await getRiskHistory(id).catch(() => []);
      setRiskHistory(rh || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ShipmentDetail] Failed to load shipment:", err);
      setLoadError("Could not load this shipment's details. It may have been deleted or is unavailable.");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("shipments", { filter: `id=eq.${id}`, onChange: load });
  useRealtimeTable("gps_locations", { filter: `shipment_id=eq.${id}`, onChange: load });
  useRealtimeTable("risk_score_history", { filter: `shipment_id=eq.${id}`, onChange: load });

  const runRainAndReroute = async () => {
    if (!shipment) return;
    setSimulating(true);
    try {
      const midpoint = {
        lat: (shipment.source_lat + shipment.destination_lat) / 2,
        lng: (shipment.source_lng + shipment.destination_lng) / 2,
      };
      await simulateWeatherEvent({ lat: midpoint.lat, lng: midpoint.lng, region: `${shipment.source_name} - ${shipment.destination_name} corridor`, condition: "heavy_rain", rainfallMm: 55 });
      await simulateRoadEvent({ lat: midpoint.lat, lng: midpoint.lng, segment: "Mid-corridor segment", status: "at_risk", reason: "Heavy rainfall reducing visibility and traction" });

      const mlEval = await evaluateAiMl({
        weather: { condition: "heavy_rain", rainfall_mm: 55 },
        roadStatus: "at_risk",
        priority: shipment.priority,
        terrain: "hill",
      });

      const risk = computeRisk({
        weather: { condition: "heavy_rain", rainfall_mm: 55 },
        nearbyIncidents: [],
        roadStatus: "at_risk",
        priority: shipment.priority,
        routeDeviationKm: null,
        terrain: "hill",
        mlEvaluation: mlEval,
      });

      const updated = await updateShipment(shipment.id, {
        risk_score: risk.score,
        risk_level: risk.level,
        risk_explanation: risk.explanation,
        status: "rerouting",
      });
      await insertRiskHistory({ shipmentId: shipment.id, score: risk.score, factors: risk.factors, explanation: risk.explanation });

      await createAlert({
        shipmentId: shipment.id,
        organizationId: shipment.organization_id,
        type: "rainfall",
        what: `Heavy rainfall detected on route (${risk.score}/100 risk, was previously lower)`,
        whereText: "Mid-corridor segment, " + shipment.source_name + " → " + shipment.destination_name,
        severity: risk.level === "CRITICAL" ? "critical" : risk.level === "VERY HIGH" ? "very_high" : "high",
        recommendedAction: "Switch to alternate route — adds travel time but avoids the at-risk segment.",
      });

      setShipment(updated);
      await load();
    } finally {
      setSimulating(false);
    }
  };

  const checkLiveConditions = async () => {
    if (!shipment) return;
    setCheckingLive(true);
    try {
      const midpoint = {
        lat: (shipment.source_lat + shipment.destination_lat) / 2,
        lng: (shipment.source_lng + shipment.destination_lng) / 2,
      };
      const [weather, hazard] = await Promise.all([
        getPointWeather(midpoint),
        Promise.resolve(getHazardScore(midpoint)),
      ]);

      const mlEval = await evaluateAiMl({
        weather: { condition: weather.condition, rainfall_mm: weather.rainfall_mm, windKmh: weather.windKmh },
        historicalHazard: { score: hazard.score, explanation: hazard.zone ? `Corridor crosses ${hazard.zone}` : null, hazardType: hazard.hazardType },
        priority: shipment.priority,
        terrain: hazard.hazardType?.includes("landslide") ? "hill" : "mixed",
      });

      const risk = computeRisk({
        weather: { condition: weather.condition, rainfall_mm: weather.rainfall_mm },
        nearbyIncidents: [],
        roadStatus: null,
        priority: shipment.priority,
        routeDeviationKm: null,
        terrain: hazard.hazardType?.includes("landslide") ? "hill" : "mixed",
        hazard: { score: hazard.score, explanation: hazard.zone ? `Corridor crosses ${hazard.zone}` : null },
        mlEvaluation: mlEval,
      });

      setLiveConditions({ weather, hazard, risk, mlEvaluation: mlEval });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to fetch live conditions:", err.message);
    } finally {
      setCheckingLive(false);
    }
  };

  // Explicit Transport Manager Route Confirmation
  const confirmRouteChange = async () => {
    if (!shipment?.alternate_route_json) return;

    // 1. Update shipment route & driver route
    const updated = await updateShipment(shipment.id, {
      route_json: shipment.alternate_route_json,
      alternate_route_json: shipment.route_json,
      status: "in_transit",
      distance_km: shipment.alternate_route_json.distanceKm,
    });
    setShipment(updated);

    // 2. Trigger driver call workflow & display success banner
    setCallSuccessMessage(true);
    setShowCallModal(true);
  };

  const rejectRouteChange = async () => {
    // Transport Manager rejects change -> keep current route & reset status to in_transit
    const updated = await updateShipment(shipment.id, {
      status: "in_transit",
    });
    setShipment(updated);
  };

  if (!shipment) {
    return (
      <div className="panel p-8 text-center max-w-md mx-auto my-12 space-y-3">
        <p className="text-ink-muted text-sm font-mono">
          {loadError || "Loading shipment details…"}
        </p>
      </div>
    );
  }

  const chartData = riskHistory.map((r) => ({ t: new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), score: r.score }));

  const currentEtaMin = shipment.route_json?.durationMin || 0;
  const altEtaMin = shipment.alternate_route_json?.durationMin || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <PriorityBadge priority={shipment.priority} />
            <StatusBadge status={shipment.status} />
          </div>
          <h1 className="text-2xl font-semibold">{shipment.source_name} → {shipment.destination_name}</h1>
          <p className="text-sm text-ink-muted">{shipment.goods_type.replace(/_/g, " ")} · {shipment.vehicle?.registration_no} · {shipment.driver?.full_name}</p>
        </div>
        <RiskBadge score={shipment.risk_score} />
      </div>

      {callSuccessMessage && (
        <div className="panel p-4 border-risk-low/50 bg-risk-low/10 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-risk-low font-semibold">
            <span>✅ Route changed successfully</span>
            <span className="text-ink">📞 Calling driver...</span>
          </div>
          <button onClick={() => setCallSuccessMessage(false)} className="text-xs text-ink-faint hover:text-ink">Dismiss</button>
        </div>
      )}

      {/* Transport Manager Route Confirmation Card */}
      {shipment.status === "rerouting" && shipment.alternate_route_json && (
        <div className="panel p-5 border-2 border-risk-high bg-risk-high/10 space-y-4">
          <div className="flex items-center gap-2 text-risk-high font-bold text-base tracking-wide uppercase">
            <span>⚠ ROUTE CHANGE REQUIRED</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-base-raised/80 p-4 rounded-lg border border-base-border">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">Driver</p>
              <p className="font-semibold text-ink">{shipment.driver?.full_name || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">Shipment</p>
              <p className="font-semibold text-ink">{shipment.goods_type.replace(/_/g, " ")} #{shipment.id.slice(0, 8)}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">Reason</p>
              <p className="text-risk-high font-medium">Danger zone or severe disruption detected on current active route.</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">Previous Route</p>
              <p className="font-mono text-ink-muted">Route A ({shipment.distance_km?.toFixed(1)} km)</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">New Safe Route</p>
              <p className="font-mono text-signal font-semibold">Route B ({shipment.alternate_route_json.distanceKm.toFixed(1)} km)</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">Previous ETA</p>
              <p className="font-mono text-ink-muted">{formatDuration(currentEtaMin)}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-ink-faint">New ETA</p>
              <p className="font-mono text-signal font-semibold">{formatDuration(altEtaMin)}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={rejectRouteChange} className="btn-secondary text-sm px-4 py-2">
              Reject Change
            </button>
            <button onClick={confirmRouteChange} className="btn-primary text-sm px-5 py-2">
              Confirm Route Change
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 panel p-3">
          <RouteMap
            source={{ lat: shipment.source_lat, lng: shipment.source_lng }}
            destination={{ lat: shipment.destination_lat, lng: shipment.destination_lng }}
            current={gps ? { lat: gps.lat, lng: gps.lng } : null}
            recommendedPath={shipment.route_json?.overviewPath}
            alternatePath={shipment.alternate_route_json?.overviewPath}
            height={420}
          />
        </div>

        <div className="space-y-4">
          <div className="panel p-4 space-y-3">
            <Row label="Original ETA" value={formatEta(shipment.eta_original)} />
            <Row label="Current ETA" value={formatEta(shipment.eta_current)} />
            <Row label="Delay" value={shipment.delay_minutes > 0 ? `${shipment.delay_minutes} min` : "None"} />
            <Row label="Distance" value={shipment.distance_km ? `${shipment.distance_km.toFixed(1)} km` : "—"} />
            <Row label="Duration" value={shipment.route_json ? formatDuration(shipment.route_json.durationMin) : "—"} />
            <Row label="Connectivity" value={shipment.connectivity} />
          </div>

          {chartData.length > 1 && (
            <div className="panel p-4">
              <p className="eyebrow mb-2">Risk Trend</p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData}>
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "#5A6685" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#5A6685" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={{ background: "#131C2E", border: "1px solid #24304A", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="score" stroke="#2FD9C4" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="panel p-4">
            <p className="eyebrow mb-2">Risk Explanation</p>
            <p className="text-sm text-ink-muted">{shipment.risk_explanation || "No elevated risk factors."}</p>
          </div>

          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="eyebrow">AI/ML Intelligence & Live Weather</p>
              <button onClick={checkLiveConditions} disabled={checkingLive} className="text-xs text-signal underline">
                {checkingLive ? "Checking…" : "Evaluate AI/ML"}
              </button>
            </div>
            {liveConditions ? (
              <div className="space-y-2 text-sm">
                {liveConditions.mlEvaluation && (
                  <div className="bg-base-raised p-2.5 rounded border border-base-border space-y-1 text-xs mb-2">
                    <p className="font-mono text-signal uppercase tracking-wider text-[10px]">AI/ML First Evaluation</p>
                    <Row label="Disruption Probability" value={`${Math.round(liveConditions.mlEvaluation.disruption_probability * 100)}%`} />
                    <Row label="Predicted Delay" value={`${liveConditions.mlEvaluation.predicted_delay_minutes} min`} />
                    <Row label="Hazard Severity" value={liveConditions.mlEvaluation.hazard_severity} />
                    <Row label="Confidence" value={`${Math.round(liveConditions.mlEvaluation.confidence * 100)}%`} />
                  </div>
                )}
                <Row label="Corridor weather" value={`${conditionLabel(liveConditions.weather.condition)}${liveConditions.weather.rainfall_mm > 0 ? ` · ${liveConditions.weather.rainfall_mm.toFixed(1)}mm/h` : ""}`} />
                {liveConditions.weather.temperatureC != null && <Row label="Temperature" value={`${liveConditions.weather.temperatureC}°C`} />}
                <Row label="Historical hazard score" value={`${liveConditions.hazard.score}/100`} />
                {liveConditions.hazard.zone && <Row label="Nearest hazard zone" value={liveConditions.hazard.zone} />}
                <p className="text-xs text-ink-faint pt-2 border-t border-base-border">{liveConditions.risk.explanation}</p>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">Pulls live weather (Open-Meteo) and historical hazard exposure for corridor evaluation.</p>
            )}
          </div>
        </div>
      </div>

      {showCallModal && (
        <CallDriverModal
          shipmentId={shipment.id}
          driver={shipment.driver}
          initiatedBy={profile?.id}
          reason="route_changed"
          detail={`${shipment.source_name} → ${shipment.destination_name}`}
          onClose={() => setShowCallModal(false)}
        />
      )}

      <div className="panel p-4 border-dashed border-2 border-base-border">
        <p className="eyebrow mb-2">Demo Mode — Scenario Controls</p>
        <p className="text-xs text-ink-faint mb-3">
          Simulates a disruption end-to-end: evaluates AI/ML disruption index, recalculates risk, and prompts Transport Manager for route change confirmation.
        </p>
        <button onClick={runRainAndReroute} disabled={simulating} className="btn-secondary">
          {simulating ? "Simulating…" : "Simulate Heavy Rainfall + Road Risk"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="data-mono capitalize">{value}</span>
    </div>
  );
}
