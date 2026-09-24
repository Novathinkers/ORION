import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { listSosAlerts, acknowledgeSosAlert, resolveSosAlert } from "../../lib/sosService";
import { supabase } from "../../lib/supabaseClient";
import CallDriverModal from "../../components/shared/CallDriverModal";

export default function SOSEmergencyCenter() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL"); // ALL | ACTIVE | ACKNOWLEDGED | RESOLVED

  // Call Driver Modal state
  const [showCallModal, setShowCallModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  // Resolution Notes Modal state
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolvingAlertId, setResolvingAlertId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await listSosAlerts();
      setAlerts(data || []);
    } catch (err) {
      console.warn("Failed to fetch SOS alerts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    // Supabase Realtime Subscription for instant incoming SOS alerts
    const channel = supabase
      .channel("admin_sos_emergency_feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sos_alerts" },
        (payload) => {
          console.log("[SOSEmergencyCenter] Realtime SOS change:", payload);
          fetchAlerts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId) => {
    await acknowledgeSosAlert(alertId, user?.id || profile?.id);
    fetchAlerts();
  };

  const handleOpenResolveModal = (alertId) => {
    setResolvingAlertId(alertId);
    setResolutionNotes("");
    setShowResolveModal(true);
  };

  const handleConfirmResolve = async (e) => {
    e.preventDefault();
    if (!resolvingAlertId) return;
    setResolving(true);
    try {
      await resolveSosAlert(resolvingAlertId, user?.id || profile?.id, resolutionNotes);
      setShowResolveModal(false);
      fetchAlerts();
    } finally {
      setResolving(false);
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

  const filteredAlerts = alerts.filter((a) => {
    if (filter === "ACTIVE") return a.status === "ACTIVE" || a.status === "CREATED" || a.status === "OFFLINE_QUEUED";
    if (filter === "ACKNOWLEDGED") return a.status === "ACKNOWLEDGED";
    if (filter === "RESOLVED") return a.status === "RESOLVED";
    return true;
  });

  const activeCount = alerts.filter((a) => ["ACTIVE", "CREATED", "OFFLINE_QUEUED"].includes(a.status)).length;
  const ackCount = alerts.filter((a) => a.status === "ACKNOWLEDGED").length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="live-dot" />
            <p className="eyebrow">Realtime Incident Command</p>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <span>🚨</span>
            <span>SOS Emergency Center</span>
          </h1>
          <p className="text-xs text-ink-muted">
            Incoming driver emergency alerts received via Realtime, Satellite Sync, or Offline Queue.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 bg-base-raised p-1 rounded-lg border border-base-border">
          <button
            onClick={() => setFilter("ALL")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors ${
              filter === "ALL" ? "bg-signal text-base-panel" : "text-ink-muted hover:text-ink"
            }`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter("ACTIVE")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors flex items-center gap-1 ${
              filter === "ACTIVE" ? "bg-risk-veryhigh text-white" : "text-risk-veryhigh hover:bg-risk-veryhigh/10"
            }`}
          >
            <span>🚨 Active</span>
            {activeCount > 0 && <span className="px-1.5 py-0.2 rounded-full bg-white text-risk-veryhigh text-[10px]">{activeCount}</span>}
          </button>
          <button
            onClick={() => setFilter("ACKNOWLEDGED")}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors ${
              filter === "ACKNOWLEDGED" ? "bg-risk-moderate text-base-panel" : "text-risk-moderate hover:bg-risk-moderate/10"
            }`}
          >
            Acknowledged ({ackCount})
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
      </div>

      {/* Incoming SOS Feed Grid */}
      {loading ? (
        <div className="p-8 text-center text-xs font-mono text-ink-muted">Loading emergency feed...</div>
      ) : filteredAlerts.length === 0 ? (
        <div className="panel p-10 text-center space-y-2 border-dashed border-base-border">
          <span className="text-3xl">🟢</span>
          <h3 className="text-base font-bold text-ink">No Active Emergency Alerts</h3>
          <p className="text-xs text-ink-muted">All driver corridors operating nominally. Emergency stream active.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAlerts.map((alert) => {
            const isUnresolved = ["ACTIVE", "CREATED", "OFFLINE_QUEUED"].includes(alert.status);
            const isAck = alert.status === "ACKNOWLEDGED";

            return (
              <div
                key={alert.id}
                className={`panel p-5 space-y-4 border-2 transition-all ${
                  isUnresolved
                    ? "border-risk-veryhigh shadow-xl bg-risk-veryhigh/5 animate-pulse"
                    : isAck
                    ? "border-risk-moderate/60 bg-risk-moderate/5"
                    : "border-base-border opacity-85"
                }`}
              >
                {/* Header Badge */}
                <div className="flex items-start justify-between gap-2 border-b border-base-border pb-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-risk-veryhigh uppercase tracking-wider block mb-1">
                      🚨 OFFLINE SOS ALERT
                    </span>
                    <h2 className="text-base font-bold text-ink">{alert.emergency_type || "Emergency Alert"}</h2>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono uppercase ${
                      isUnresolved
                        ? "bg-risk-veryhigh text-white"
                        : isAck
                        ? "bg-risk-moderate text-base-panel"
                        : "bg-signal text-base-panel"
                    }`}
                  >
                    {alert.status}
                  </span>
                </div>

                {/* Info Fields */}
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Driver Name:</p>
                    <p className="font-semibold text-ink">{alert.driver_name}</p>
                    {alert.driver_phone && <p className="text-[11px] text-ink-faint font-normal">{alert.driver_phone}</p>}
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Vehicle Reg:</p>
                    <p className="font-semibold text-ink">{alert.vehicle_no}</p>
                    <p className="text-[11px] text-ink-faint font-normal">{alert.company_name}</p>
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Communication:</p>
                    <p className="font-semibold text-signal uppercase">{alert.communication_provider || "Internet"}</p>
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-muted uppercase">Received At:</p>
                    <p className="font-semibold text-ink">
                      {alert.created_at ? new Date(alert.created_at).toLocaleTimeString("en-IN") : "Just now"}
                    </p>
                  </div>
                </div>

                {/* GPS Location Coordinates */}
                <div className="p-2.5 rounded bg-base-raised border border-base-border text-xs font-mono flex items-center justify-between">
                  <span className="text-ink-muted">Location Coordinates:</span>
                  <span className="text-signal font-bold">
                    📍 {alert.latitude ? `${Number(alert.latitude).toFixed(4)}, ${Number(alert.longitude).toFixed(4)}` : "Location Unknown"}
                  </span>
                </div>

                {/* Message notes */}
                {alert.message && (
                  <p className="text-xs text-ink-muted italic border-l-2 border-risk-veryhigh pl-2">
                    "{alert.message}"
                  </p>
                )}

                {/* Resolution Notes if resolved */}
                {alert.status === "RESOLVED" && alert.resolution_notes && (
                  <p className="text-xs text-signal font-mono border-l-2 border-signal pl-2">
                    Resolution: {alert.resolution_notes}
                  </p>
                )}

                {/* Action Buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-base-border">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/map?lat=${alert.latitude}&lng=${alert.longitude}&sos=true`)}
                    className="btn-secondary py-2 text-[11px] font-mono font-bold flex items-center justify-center gap-1"
                  >
                    <span>📍</span>
                    <span>VIEW MAP</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCallDriver(alert)}
                    className="btn-secondary py-2 text-[11px] font-mono font-bold flex items-center justify-center gap-1 text-signal"
                  >
                    <span>📞</span>
                    <span>CALL DRIVER</span>
                  </button>

                  {isUnresolved && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(alert.id)}
                      className="btn-secondary py-2 text-[11px] font-mono font-bold bg-risk-moderate/20 text-risk-moderate hover:bg-risk-moderate/30 flex items-center justify-center gap-1 col-span-2 sm:col-span-1"
                    >
                      <span>✍️</span>
                      <span>ACKNOWLEDGE</span>
                    </button>
                  )}

                  {alert.status !== "RESOLVED" && (
                    <button
                      type="button"
                      onClick={() => handleOpenResolveModal(alert.id)}
                      className="btn-primary py-2 text-[11px] font-mono font-bold bg-signal text-base-panel flex items-center justify-center gap-1 col-span-2 sm:col-span-1"
                    >
                      <span>✅</span>
                      <span>RESOLVE</span>
                    </button>
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

      {/* Resolution Notes Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleConfirmResolve} className="panel max-w-md w-full p-6 space-y-4 border-signal shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <span>✅</span>
                <span>Resolve SOS Emergency Alert</span>
              </h3>
              <button type="button" onClick={() => setShowResolveModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <p className="text-xs text-ink-muted">Enter dispatch resolution details or field team actions taken:</p>

            <textarea
              rows={3}
              required
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="e.g. Field relief team dispatched, road cleared, driver safe..."
              className="input text-xs"
            />

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowResolveModal(false)} className="btn-secondary flex-1 text-xs">
                Cancel
              </button>
              <button type="submit" disabled={resolving} className="btn-primary flex-1 font-bold text-xs bg-signal text-base-panel">
                {resolving ? "Saving..." : "Confirm Resolved ✓"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
