import { useSOS } from "../../hooks/useSOS";
import { useGeolocation } from "../../hooks/useGeolocation";

export default function SOSStatusCard() {
  const { sosStatus, lastResult, queuedAlerts, isOffline, connectionStatus } = useSOS();
  const geo = useGeolocation();

  const hasCurrentGps = !!geo.position;
  const queuedCount = queuedAlerts.length;

  return (
    <div className="panel p-4 space-y-3 border border-base-border">
      <div className="flex items-center justify-between border-b border-base-border pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
          <span>📡</span>
          <span>Emergency System Status</span>
        </h4>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
            isOffline ? "bg-risk-veryhigh/20 text-risk-veryhigh" : "bg-signal/20 text-signal"
          }`}
        >
          {isOffline ? "⚠️ Offline Mode" : "🟢 Network Online"}
        </span>
      </div>

      {/* GPS Location Status */}
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-ink-muted">GPS Location Status:</span>
        {hasCurrentGps ? (
          <span className="text-signal font-bold flex items-center gap-1">
            <span>📍</span>
            <span>Current GPS Active ({geo.position.accuracyM ? `±${Math.round(geo.position.accuracyM)}m` : "High Acc"})</span>
          </span>
        ) : (
          <span className="text-risk-moderate font-bold flex items-center gap-1">
            <span>⚠️</span>
            <span>Last Known Location Fallback</span>
          </span>
        )}
      </div>

      {/* Communication Provider Status */}
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-ink-muted">Active Channel:</span>
        <span className="text-ink font-semibold">
          {isOffline ? "Satellite / SMS / Offline Queue" : "Internet -> Supabase Realtime"}
        </span>
      </div>

      {/* Live SOS Status Banner */}
      {sosStatus === "SENDING" && (
        <div className="p-3 rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-400 text-xs font-mono font-bold flex items-center gap-2">
          <span className="animate-spin text-base">🔵</span>
          <span>Sending Emergency Alert...</span>
        </div>
      )}

      {sosStatus === "DELIVERED" && (
        <div className="p-3 rounded-lg bg-signal/15 border border-signal/40 text-signal text-xs font-mono font-bold flex items-center gap-2">
          <span className="text-base">🟢</span>
          <span>SOS Delivered to ORION Admin Command Center</span>
        </div>
      )}

      {sosStatus === "OFFLINE_QUEUED" && (
        <div className="p-3 rounded-lg bg-risk-moderate/15 border border-risk-moderate/40 text-risk-moderate text-xs font-mono font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🟡</span>
            <span>SOS Queued — Waiting for connectivity</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-risk-moderate/20 font-bold">{queuedCount} Queued</span>
        </div>
      )}

      {sosStatus === "FAILED" && (
        <div className="p-3 rounded-lg bg-risk-veryhigh/15 border border-risk-veryhigh/40 text-risk-veryhigh text-xs font-mono font-bold flex items-center gap-2">
          <span className="text-base">🔴</span>
          <span>SOS Delivery Failed — Retrying Automatically</span>
        </div>
      )}

      {queuedCount > 0 && sosStatus !== "OFFLINE_QUEUED" && (
        <div className="p-2.5 rounded-lg bg-base-raised border border-base-border text-xs font-mono flex items-center justify-between">
          <span className="text-ink-muted">Pending Offline Queued Alerts:</span>
          <span className="text-risk-moderate font-bold">{queuedCount} Alert(s) Saved</span>
        </div>
      )}
    </div>
  );
}
