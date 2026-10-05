import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { listOrgAlerts, listAllAlerts, acknowledgeAlert } from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import AlertCard from "../../components/shared/AlertCard";

export default function Alerts() {
  const { profile, user } = useAuth();
  const orgId = profile?.organization_id;
  const [alerts, setAlerts] = useState([]);

  const load = useCallback(async () => {
    try {
      if (!orgId) {
        setAlerts(await listAllAlerts().catch(() => []));
        return;
      }
      setAlerts(await listOrgAlerts(orgId).catch(() => listAllAlerts().catch(() => [])));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Alerts] Failed to load alerts:", err);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("alerts", { filter: orgId ? `organization_id=eq.${orgId}` : undefined, onChange: load });

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-semibold">Alerts</h1>
      {alerts.length === 0 ? (
        <p className="text-sm text-ink-muted">No active alerts at this time.</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a} onAcknowledge={(id) => acknowledgeAlert(id, user?.id).then(load)} />
          ))}
        </div>
      )}
    </div>
  );
}
