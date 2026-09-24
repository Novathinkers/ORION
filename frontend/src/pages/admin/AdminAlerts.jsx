import { useEffect, useState, useCallback } from "react";
import { listAllAlerts, getActiveIncidents, getActiveRoadIssues } from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import AlertCard from "../../components/shared/AlertCard";

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [roadIssues, setRoadIssues] = useState([]);
  const [tab, setTab] = useState("alerts");

  const load = useCallback(async () => {
    setAlerts(await listAllAlerts());
    setIncidents(await getActiveIncidents());
    setRoadIssues(await getActiveRoadIssues());
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("alerts", { onChange: load });
  useRealtimeTable("incidents", { onChange: load });
  useRealtimeTable("road_conditions", { onChange: load });

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-semibold">Alerts & Incidents</h1>

      <div className="flex gap-2">
        {["alerts", "incidents", "roads"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
              tab === t ? "bg-signal/10 text-signal border border-signal/40" : "text-ink-muted border border-base-border"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "alerts" && (
        <div className="space-y-3">
          {alerts.length === 0 && <p className="text-sm text-ink-muted">No alerts system-wide.</p>}
          {alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
        </div>
      )}

      {tab === "incidents" && (
        <div className="panel divide-y divide-base-border">
          {incidents.length === 0 && <p className="p-4 text-sm text-ink-muted">No active incidents.</p>}
          {incidents.map((i) => (
            <div key={i.id} className="p-4">
              <p className="text-sm text-ink capitalize font-medium">{i.type.replace("_", " ")} · <span className="text-xs uppercase text-risk-moderate">{i.severity}</span></p>
              <p className="text-xs text-ink-muted mt-1">{i.description}</p>
              <p className="text-xs text-ink-faint mt-1 font-mono">{i.lat.toFixed(3)}, {i.lng.toFixed(3)} · source: {i.source}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "roads" && (
        <div className="panel divide-y divide-base-border">
          {roadIssues.length === 0 && <p className="p-4 text-sm text-ink-muted">All corridors open.</p>}
          {roadIssues.map((r) => (
            <div key={r.id} className="p-4">
              <p className="text-sm text-ink capitalize font-medium">{r.road_segment} · <span className="text-xs uppercase text-risk-high">{r.status.replace("_"," ")}</span></p>
              <p className="text-xs text-ink-muted mt-1">{r.reason}</p>
              <p className="text-xs text-ink-faint mt-1 font-mono">source: {r.source}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
