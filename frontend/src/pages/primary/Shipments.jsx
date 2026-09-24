import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { listOrgShipments, listAllShipments } from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import StatusBadge, { PriorityBadge } from "../../components/shared/StatusBadge";
import RiskBadge from "../../components/shared/RiskBadge";
import { formatEta } from "../../lib/mapsService";

const STATUS_FILTERS = ["all", "assigned", "ready_to_start", "in_transit", "delayed", "rerouting", "arrived", "delivered"];

export default function Shipments() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const [shipments, setShipments] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      if (!orgId) {
        const fallbackData = await listAllShipments().catch(() => []);
        setShipments(fallbackData || []);
        return;
      }
      const data = await listOrgShipments(orgId).catch(() => listAllShipments().catch(() => []));
      setShipments(data || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Shipments] Failed to load shipments:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("shipments", { filter: orgId ? `organization_id=eq.${orgId}` : undefined, onChange: load });

  const filtered = filter === "all" ? shipments : shipments.filter((s) => s.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shipments</h1>
        <Link to="/primary/shipments/new" className="btn-primary">+ Create Shipment</Link>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f ? "bg-signal/10 text-signal border-signal/40" : "border-base-border text-ink-muted hover:text-ink"
            }`}
          >
            {f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-ink-muted font-mono animate-pulse">Loading shipments…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-8 text-center text-ink-muted text-sm">
          No shipments match this filter. Click "+ Create Shipment" to create one.
        </div>
      ) : (
        <div className="panel divide-y divide-base-border">
          {filtered.map((s) => (
            <Link key={s.id} to={`/primary/shipments/${s.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-base-raised transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <PriorityBadge priority={s.priority} />
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-sm text-ink truncate">{s.source_name} → {s.destination_name}</p>
                <p className="text-xs text-ink-faint">
                  {s.driver?.full_name || "Unassigned"} · {s.vehicle?.registration_no || "—"} · {s.goods_type.replace(/_/g," ")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <RiskBadge score={s.risk_score} size="sm" />
                <p className="text-xs text-ink-faint mt-1 font-mono">ETA {formatEta(s.eta_current || s.eta_original)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
