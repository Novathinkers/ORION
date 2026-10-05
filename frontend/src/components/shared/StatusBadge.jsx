const SHIPMENT_STYLES = {
  assigned: "bg-base-raised text-ink-muted border-base-border",
  ready_to_start: "bg-signal/10 text-signal border-signal/30",
  in_transit: "bg-signal/15 text-signal border-signal/40",
  delayed: "bg-risk-high/15 text-risk-high border-risk-high/30",
  rerouting: "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/30",
  arrived: "bg-risk-low/15 text-risk-low border-risk-low/30",
  delivered: "bg-risk-low/20 text-risk-low border-risk-low/40",
  cancelled: "bg-ink-faint/15 text-ink-faint border-ink-faint/30",
};

const LABELS = {
  assigned: "Assigned",
  ready_to_start: "Ready to start",
  in_transit: "In transit",
  delayed: "Delayed",
  rerouting: "Rerouting",
  arrived: "Arrived",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export default function StatusBadge({ status }) {
  const style = SHIPMENT_STYLES[status] || SHIPMENT_STYLES.assigned;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}>
      {LABELS[status] || status}
    </span>
  );
}

const PRIORITY_STYLES = {
  normal: "bg-base-raised text-ink-muted border-base-border",
  high: "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/30",
  critical: "bg-risk-critical/15 text-risk-critical border-risk-critical/30",
};

export function PriorityBadge({ priority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
        PRIORITY_STYLES[priority] || PRIORITY_STYLES.normal
      }`}
    >
      {priority}
    </span>
  );
}

const CONN_LABEL = { online: "Online", offline: "Offline", syncing: "Syncing…", synced: "Synced" };
const CONN_STYLE = {
  online: "text-risk-low",
  offline: "text-risk-veryhigh",
  syncing: "text-risk-moderate",
  synced: "text-signal",
};

export function ConnectivityBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${CONN_STYLE[status] || "text-ink-muted"}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "syncing" ? "animate-blink" : ""}`} />
      {CONN_LABEL[status] || status}
    </span>
  );
}
