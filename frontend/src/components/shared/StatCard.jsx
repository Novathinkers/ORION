export default function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow mb-2">{label}</p>
      <p className={`font-display text-3xl font-semibold ${accent ? "text-signal" : "text-ink"}`}>{value}</p>
      {sub && <p className="text-xs text-ink-muted mt-1">{sub}</p>}
    </div>
  );
}
