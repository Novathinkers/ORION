import { formatDistanceToNow } from "date-fns";

const SEVERITY_STYLE = {
  low: "border-l-risk-low",
  moderate: "border-l-risk-moderate",
  high: "border-l-risk-high",
  very_high: "border-l-risk-veryhigh",
  critical: "border-l-risk-critical",
};

const SEVERITY_LABEL = { low: "LOW", moderate: "MODERATE", high: "HIGH", very_high: "VERY HIGH", critical: "CRITICAL" };

export default function AlertCard({ alert, onAcknowledge }) {
  return (
    <div className={`panel border-l-4 ${SEVERITY_STYLE[alert.severity] || "border-l-base-border"} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow">{SEVERITY_LABEL[alert.severity]}</span>
            <span className="text-ink-faint text-xs">·</span>
            <span className="text-xs text-ink-faint font-mono">
              {alert.created_at ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true }) : ""}
            </span>
          </div>
          <p className="text-sm font-medium text-ink">{alert.what}</p>
          <p className="text-xs text-ink-muted mt-1">
            <span className="text-ink-faint">Where:</span> {alert.where_text}
          </p>
          {alert.shipments && (
            <p className="text-xs text-ink-muted">
              <span className="text-ink-faint">Shipment:</span> {alert.shipments.source_name} → {alert.shipments.destination_name}
            </p>
          )}
          <p className="text-xs text-signal mt-2">
            <span className="text-ink-faint">Recommended:</span> {alert.recommended_action}
          </p>
        </div>
        {onAcknowledge && !alert.acknowledged && (
          <button onClick={() => onAcknowledge(alert.id)} className="btn-secondary text-xs px-2.5 py-1.5 shrink-0">
            Acknowledge
          </button>
        )}
        {alert.acknowledged && (
          <span className="text-xs text-ink-faint shrink-0">Acknowledged</span>
        )}
      </div>
    </div>
  );
}
