import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { listInactivityAlerts, updateInactivityAlertStatus, createInactivityAlert, scanExistingDriversForInactivity, formatOfflineDuration, formatOfflineDurationFromDate } from "../../lib/inactivityService";
import { listAllShipments } from "../../lib/dataService";
import { supabase } from "../../lib/supabaseClient";
import CallDriverModal from "../../components/shared/CallDriverModal";

export default function InactivityAlertCenter() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState([]);
  const [realShipments, setRealShipments] = useState([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL"); // ALL | LOST | INCIDENT | HIGH_RISK | INVESTIGATING | RESOLVED

  // Call Driver Modal state
  const [showCallModal, setShowCallModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  // False Alarm / Confirmation Modal state
  const [showActionModal, setShowActionModal] = useState(false);
  const [targetAlertId, setTargetAlertId] = useState(null);
  const [actionType, setActionType] = useState("FALSE_ALARM"); // FALSE_ALARM | CONFIRMED_INCIDENT
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      // 1. Scan existing real active drivers in database
      await scanExistingDriversForInactivity().catch(() => []);
      
      // 2. Fetch all connectivity alerts
      const data = await listInactivityAlerts();
      setAlerts(data || []);

      // 3. Fetch existing shipments for driver selector
      const allShipments = await listAllShipments().catch(() => []);
      setRealShipments(allShipments || []);
      if (allShipments.length > 0 && !selectedShipmentId) {
        setSelectedShipmentId(allShipments[0].id);
      }
    } catch (err) {
      console.warn("Failed to fetch inactivity alerts:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedShipmentId]);

  useEffect(() => {
    fetchAlerts();

    // Periodic scanner every 15s for active driver inactivity monitoring
    const interval = setInterval(fetchAlerts, 15000);

    // Supabase Realtime Subscription for instant incoming connectivity alerts
    const channel = supabase
      .channel("admin_inactivity_alerts_feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_connectivity_alerts" },
        () => fetchAlerts()
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchAlerts]);

  const handleInvestigate = async (alertId) => {
    await updateInactivityAlertStatus(alertId, "UNDER_INVESTIGATION", user?.id || profile?.id);
    fetchAlerts();
  };

  const handleOpenActionModal = (alertId, type) => {
    setTargetAlertId(alertId);
    setActionType(type);
    setNotes("");
    setShowActionModal(true);
  };

  const handleConfirmAction = async (e) => {
    e.preventDefault();
    if (!targetAlertId) return;
    setSubmitting(true);
    try {
      await updateInactivityAlertStatus(targetAlertId, actionType, user?.id || profile?.id, notes);
      setShowActionModal(false);
      fetchAlerts();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCallDriver = (alert) => {
    setSelectedDriver({
      id: alert.driver_id,
      full_name: alert.driver_name,
      phone: alert.driver_phone || "+91 98765 43210",
      shipmentId: alert.shipment_id,
    });
    setShowCallModal(true);
  };

  const handleSimulateForSelectedDriver = async () => {
    const targetShipment = realShipments.find((s) => s.id === selectedShipmentId) || realShipments[0];
    const driverName = targetShipment?.driver?.full_name || "Arun (TRUCK-102)";
    const driverPhone = targetShipment?.driver?.phone || "+91 98765 43210";
    const vehicleNo = targetShipment?.vehicle?.registration_no || "TN-01-AB-1234";
    const companyName = targetShipment?.organization?.name || "ORION Logistics";

    const lat = targetShipment?.source_lat || 27.4728;
    const lng = targetShipment?.source_lng || 94.9120;

    await createInactivityAlert({
      driverId: targetShipment?.driver_id,
      driverName,
      driverPhone,
      vehicleId: targetShipment?.vehicle_id,
      vehicleNo,
      companyId: targetShipment?.organization_id,
      companyName,
      shipmentId: targetShipment?.id || "SH-102",
      lastPingAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      offlineStartedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      offlineDurationMinutes: 14,
      latitude: lat,
      longitude: lng,
      lastSpeedKmh: 45,
      weatherRisk: 0.7,
      hazardRisk: 0.75,
      dangerZoneRisk: 1.0,
      inactivityRisk: 0.75,
      finalRiskScore: 82,
      alertLevel: "HIGH_RISK_INCIDENT",
      status: "POSSIBLE_INCIDENT",
    });
    fetchAlerts();
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === "ALL") return !["CONFIRMED_INCIDENT", "FALSE_ALARM", "RESOLVED"].includes(a.status);
    if (filter === "LOST") return a.alert_level === "COMMUNICATION_LOST" || a.status === "COMMUNICATION_LOST";
    if (filter === "INCIDENT") return a.alert_level === "POSSIBLE_INCIDENT" || a.status === "POSSIBLE_INCIDENT";
    if (filter === "HIGH_RISK") return a.alert_level === "HIGH_RISK_INCIDENT";
    if (filter === "INVESTIGATING") return a.status === "UNDER_INVESTIGATION";
    if (filter === "RESOLVED") return ["CONFIRMED_INCIDENT", "FALSE_ALARM", "RESOLVED"].includes(a.status);
    return true;
  });

  const lostCount = alerts.filter((a) => a.status === "COMMUNICATION_LOST").length;
  const incidentCount = alerts.filter((a) => a.status === "POSSIBLE_INCIDENT" || a.alert_level === "HIGH_RISK_INCIDENT").length;
  const investigatingCount = alerts.filter((a) => a.status === "UNDER_INVESTIGATION").length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="live-dot" />
            <p className="eyebrow">Realtime Inactivity & Disaster Detection</p>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <span>📡</span>
            <span>Driver Inactivity & Incident Alert Center</span>
          </h1>
          <p className="text-xs text-ink-muted">
            Continuous 10-minute heartbeat tracking, last known location logging, and rule-based risk context analysis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {realShipments.length > 0 && (
            <select
              value={selectedShipmentId}
              onChange={(e) => setSelectedShipmentId(e.target.value)}
              className="input text-xs font-mono py-2 px-2 bg-base-panel border-base-border max-w-[220px]"
            >
              {realShipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.driver?.full_name || "Driver"} ({s.vehicle?.registration_no || "TRUCK"})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleSimulateForSelectedDriver}
            className="btn-primary bg-risk-high text-white text-xs font-mono font-bold py-2 px-3 flex items-center gap-1.5 shadow-md hover:bg-risk-high/90 transition-all"
          >
            <span>⚡ TRIGGER 10-MIN SIGNAL LOSS FOR DRIVER</span>
          </button>
        </div>
      </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 bg-base-raised p-1 rounded-lg border border-base-border">
          <button
            onClick={() => setFilter("ALL")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors ${
              filter === "ALL" ? "bg-signal text-base-panel" : "text-ink-muted hover:text-ink"
            }`}
          >
            All ({alerts.length})
          </button>

          <button
            onClick={() => setFilter("LOST")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors flex items-center gap-1 ${
              filter === "LOST" ? "bg-risk-moderate text-base-panel" : "text-risk-moderate hover:bg-risk-moderate/10"
            }`}
          >
            <span>⚠️ Signal Lost</span>
            {lostCount > 0 && <span className="px-1.5 py-0.2 rounded-full bg-base-panel text-risk-moderate text-[10px]">{lostCount}</span>}
          </button>

          <button
            onClick={() => setFilter("INCIDENT")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors flex items-center gap-1 ${
              filter === "INCIDENT" ? "bg-risk-high text-white" : "text-risk-high hover:bg-risk-high/10"
            }`}
          >
            <span>🟠 Possible Incident</span>
            {incidentCount > 0 && <span className="px-1.5 py-0.2 rounded-full bg-white text-risk-high text-[10px]">{incidentCount}</span>}
          </button>

          <button
            onClick={() => setFilter("INVESTIGATING")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors ${
              filter === "INVESTIGATING" ? "bg-blue-500 text-white" : "text-blue-400 hover:bg-blue-500/10"
            }`}
          >
            Investigating ({investigatingCount})
          </button>

          <button
            onClick={() => setFilter("RESOLVED")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors ${
              filter === "RESOLVED" ? "bg-signal text-base-panel" : "text-ink-muted hover:text-ink"
            }`}
          >
            Resolved
          </button>
        </div>

      {/* Inactivity Alert Cards Grid */}
      {loading ? (
        <div className="p-8 text-center text-xs font-mono text-ink-muted">Loading driver connectivity feed...</div>
      ) : filteredAlerts.length === 0 ? (
        <div className="panel p-10 text-center space-y-2 border-dashed border-base-border">
          <span className="text-3xl">🟢</span>
          <h3 className="text-base font-bold text-ink">All Driver Communications Active</h3>
          <p className="text-xs text-ink-muted">No driver inactivity or signal loss detected above 10-minute thresholds.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAlerts.map((alert) => {
            const isHighRisk = alert.alert_level === "HIGH_RISK_INCIDENT" || alert.final_risk_score >= 60;
            const isPossible = alert.alert_level === "POSSIBLE_INCIDENT" || alert.status === "POSSIBLE_INCIDENT";
            const isInvestigating = alert.status === "UNDER_INVESTIGATION";
            const isConfirmed = alert.status === "CONFIRMED_INCIDENT";
            const isFalseAlarm = alert.status === "FALSE_ALARM";

            return (
              <div
                key={alert.id}
                className={`panel p-5 space-y-4 border-2 transition-all ${
                  isHighRisk
                    ? "border-risk-critical shadow-xl bg-risk-critical/10"
                    : isPossible
                    ? "border-risk-high shadow-lg bg-risk-high/5"
                    : isInvestigating
                    ? "border-blue-500/60 bg-blue-500/5"
                    : isConfirmed
                    ? "border-risk-veryhigh bg-risk-veryhigh/10"
                    : "border-base-border opacity-85"
                }`}
              >
                {/* Header Badge */}
                <div className="flex items-start justify-between gap-2 border-b border-base-border pb-3">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-signal uppercase tracking-wider block mb-1">
                      {alert.alert_level?.replace(/_/g, " ")}
                    </span>
                    <h2 className="text-base font-bold text-ink flex items-center gap-2">
                      <span>{isHighRisk ? "🔴" : isPossible ? "🟠" : "⚠️"}</span>
                      <span>{alert.driver_name}</span>
                    </h2>
                  </div>

                  <div className="text-right">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono uppercase ${
                        isHighRisk
                          ? "bg-risk-critical text-white"
                          : isPossible
                          ? "bg-risk-high text-white"
                          : isInvestigating
                          ? "bg-blue-500 text-white"
                          : isConfirmed
                          ? "bg-risk-veryhigh text-white"
                          : isFalseAlarm
                          ? "bg-signal text-base-panel"
                          : "bg-risk-moderate text-base-panel"
                      }`}
                    >
                      {alert.status?.replace(/_/g, " ")}
                    </span>
                    <p className="text-[10px] font-mono text-ink-faint mt-1">
                      Risk Score: <span className="font-bold text-risk-high">{alert.final_risk_score}/100</span>
                    </p>
                  </div>
                </div>

                {/* Driver & Vehicle Details */}
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Vehicle Reg:</p>
                    <p className="font-semibold text-ink">{alert.vehicle_no}</p>
                    <p className="text-[11px] text-ink-faint font-normal">{alert.company_name}</p>
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Phone Contact:</p>
                    <p className="font-semibold text-ink">{alert.driver_phone || "+91 98765 43210"}</p>
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Last Ping Time:</p>
                    <p className="font-semibold text-ink">
                      {alert.last_ping_at ? new Date(alert.last_ping_at).toLocaleTimeString("en-IN") : "10 min ago"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Duration Offline:</p>
                    <p className="font-bold text-risk-veryhigh">
                      ⏱ {formatOfflineDurationFromDate(alert.last_ping_at, alert.offline_duration_minutes || 11)}
                    </p>
                  </div>
                </div>

                {/* Last Known Location Coordinates */}
                <div className="p-2.5 rounded bg-base-raised border border-base-border text-xs font-mono flex items-center justify-between">
                  <span className="text-ink-muted">Last Known Location:</span>
                  <span className="text-signal font-bold">
                    📍 {alert.latitude ? `${Number(alert.latitude).toFixed(4)}, ${Number(alert.longitude).toFixed(4)}` : "Guwahati Corridor"}
                  </span>
                </div>

                {/* Context Risk Factors Pills */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-ink-muted font-mono mr-1">Risk Context:</span>
                  {alert.weather_risk > 0.5 && <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-mono font-bold">🌧️ Heavy Rain</span>}
                  {alert.hazard_risk > 0.4 && <span className="px-2 py-0.5 rounded bg-risk-high/20 text-risk-high text-[10px] font-mono font-bold">⚠️ Nearby Hazard</span>}
                  {alert.danger_zone_risk > 0.5 && <span className="px-2 py-0.5 rounded bg-risk-critical/20 text-risk-critical text-[10px] font-mono font-bold">🚨 Active Danger Zone</span>}
                  {alert.road_risk > 0.5 && <span className="px-2 py-0.5 rounded bg-risk-moderate/20 text-risk-moderate text-[10px] font-mono font-bold">🚧 Road Blocked</span>}
                  <span className="px-2 py-0.5 rounded bg-base-raised text-ink-muted text-[10px] font-mono">
                    Inactivity Factor: {Math.round((alert.inactivity_risk || 0.5) * 100)}%
                  </span>
                </div>

                {/* Resolution Notes */}
                {alert.resolution_notes && (
                  <p className="text-xs text-signal font-mono border-l-2 border-signal pl-2">
                    Notes: {alert.resolution_notes}
                  </p>
                )}

                {/* Action Controls */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-base-border">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/map?lat=${alert.latitude}&lng=${alert.longitude}&lastLocation=true`)}
                    className="btn-secondary py-2 text-[11px] font-mono font-bold flex items-center justify-center gap-1"
                  >
                    <span>📍 VIEW LOCATION</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCallDriver(alert)}
                    className="btn-secondary py-2 text-[11px] font-mono font-bold text-signal flex items-center justify-center gap-1"
                  >
                    <span>📞 CALL DRIVER</span>
                  </button>

                  {alert.shipment_id && (
                    <button
                      type="button"
                      onClick={() => navigate(`/primary/shipments/${alert.shipment_id}`)}
                      className="btn-secondary py-2 text-[11px] font-mono font-bold text-blue-400 flex items-center justify-center gap-1"
                    >
                      <span>📦 SHIPMENT</span>
                    </button>
                  )}

                  {!["CONFIRMED_INCIDENT", "FALSE_ALARM", "RESOLVED"].includes(alert.status) && (
                    <>
                      {alert.status !== "UNDER_INVESTIGATION" && (
                        <button
                          type="button"
                          onClick={() => handleInvestigate(alert.id)}
                          className="btn-secondary py-2 text-[11px] font-mono font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 flex items-center justify-center gap-1"
                        >
                          <span>🔍 INVESTIGATE</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenActionModal(alert.id, "CONFIRMED_INCIDENT")}
                        className="btn-primary py-2 text-[11px] font-mono font-bold bg-risk-critical text-white flex items-center justify-center gap-1"
                      >
                        <span>✓ CONFIRM INCIDENT</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenActionModal(alert.id, "FALSE_ALARM")}
                        className="btn-secondary py-2 text-[11px] font-mono font-bold bg-signal/20 text-signal hover:bg-signal/30 flex items-center justify-center gap-1"
                      >
                        <span>✕ FALSE ALARM</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Call Driver Modal */}
      {showCallModal && selectedDriver && (
        <CallDriverModal
          isOpen={showCallModal}
          onClose={() => setShowCallModal(false)}
          driver={selectedDriver}
          shipmentId={selectedDriver.shipmentId}
        />
      )}

      {/* Action / Investigation Notes Modal */}
      {showActionModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleConfirmAction} className="panel max-w-md w-full p-6 space-y-4 border-signal shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <span>{actionType === "CONFIRMED_INCIDENT" ? "🚨" : "✕"}</span>
                <span>{actionType === "CONFIRMED_INCIDENT" ? "Confirm Disaster Incident" : "Mark False Alarm"}</span>
              </h3>
              <button type="button" onClick={() => setShowActionModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <p className="text-xs text-ink-muted">
              {actionType === "CONFIRMED_INCIDENT"
                ? "Enter field verification notes before confirming incident status:"
                : "Enter reason for marking this signal loss as a false alarm (e.g. driver reconnected, no-network zone):"}
            </p>

            <textarea
              rows={3}
              required
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Verified via local highway authority / driver reconnected..."
              className="input text-xs"
            />

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowActionModal(false)} className="btn-secondary flex-1 text-xs">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`btn-primary flex-1 font-bold text-xs ${
                  actionType === "CONFIRMED_INCIDENT" ? "bg-risk-critical text-white" : "bg-signal text-base-panel"
                }`}
              >
                {submitting ? "Saving..." : actionType === "CONFIRMED_INCIDENT" ? "Confirm Incident ✓" : "Close False Alarm ✕"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
