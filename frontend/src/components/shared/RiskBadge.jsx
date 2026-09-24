import { riskLevelFor } from "../../lib/riskEngine";

const STYLES = {
  "risk-low": "bg-risk-low/15 text-risk-low border-risk-low/30",
  "risk-moderate": "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/30",
  "risk-high": "bg-risk-high/15 text-risk-high border-risk-high/30",
  "risk-veryhigh": "bg-risk-veryhigh/15 text-risk-veryhigh border-risk-veryhigh/30",
  "risk-critical": "bg-risk-critical/15 text-risk-critical border-risk-critical/30",
};

export default function RiskBadge({ score, size = "md" }) {
  const band = riskLevelFor(score ?? 0);
  const sizing = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-semibold ${sizing} ${STYLES[band.color]}`}
    >
      <span className="tabular-nums">{score ?? 0}</span>
      <span className="opacity-70">·</span>
      <span className="uppercase tracking-wide">{band.level}</span>
    </span>
  );
}
