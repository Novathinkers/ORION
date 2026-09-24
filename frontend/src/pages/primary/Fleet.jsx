import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { listOrgVehicles, listOrgDrivers, createVehicle } from "../../lib/dataService";
import StatusBadge from "../../components/shared/StatusBadge";

export default function Fleet() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ registrationNo: "", vehicleType: "truck", capacityKg: "" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setVehicles(await listOrgVehicles(orgId));
    setDrivers(await listOrgDrivers(orgId));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleAddVehicle = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createVehicle({
        organizationId: orgId,
        registrationNo: form.registrationNo,
        vehicleType: form.vehicleType,
        capacityKg: form.capacityKg ? Number(form.capacityKg) : null,
      });
      setForm({ registrationNo: "", vehicleType: "truck", capacityKg: "" });
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const inviteLink = `${window.location.origin}/signup/driver`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Fleet & Drivers</h1>
        <p className="text-sm text-ink-muted">Vehicles and drivers belonging to {profile?.organizations?.name}.</p>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold">Vehicles</h2>
          <button onClick={() => setShowForm((v) => !v)} className="btn-secondary text-xs px-3 py-2">
            {showForm ? "Cancel" : "+ Add Vehicle"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleAddVehicle} className="panel p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Registration No.</label>
              <input required className="input" value={form.registrationNo} onChange={(e) => setForm((f) => ({ ...f, registrationNo: e.target.value }))} placeholder="AS-01-AB-1234" />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.vehicleType} onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))}>
                <option value="truck">Truck</option>
                <option value="mini_truck">Mini Truck</option>
                <option value="van">Van</option>
                <option value="tanker">Tanker</option>
              </select>
            </div>
            <div>
              <label className="label">Capacity (kg)</label>
              <input className="input" type="number" value={form.capacityKg} onChange={(e) => setForm((f) => ({ ...f, capacityKg: e.target.value }))} />
            </div>
            <button type="submit" disabled={submitting} className="btn-primary">{submitting ? "Adding…" : "Add Vehicle"}</button>
          </form>
        )}

        <div className="panel divide-y divide-base-border">
          {vehicles.length === 0 && <p className="p-4 text-sm text-ink-muted">No vehicles yet.</p>}
          {vehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-ink font-mono">{v.registration_no}</p>
                <p className="text-xs text-ink-faint capitalize">{v.vehicle_type} {v.capacity_kg ? `· ${v.capacity_kg}kg` : ""}</p>
              </div>
              <StatusBadge status={v.status === "available" ? "ready_to_start" : v.status === "assigned" ? "assigned" : "in_transit"} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold mb-3">Drivers</h2>
        <div className="panel p-4 mb-4 bg-signal/5 border-signal/20">
          <p className="text-xs text-ink-muted mb-1">Invite a driver to your organization</p>
          <p className="text-xs text-ink-faint">
            Share this signup link — the driver enters your email ({" "}
            <span className="text-signal">{profile?.organizations ? "your account email" : ""}</span>{" "}
            ) to link their account to your organization: <span className="font-mono text-signal break-all">{inviteLink}</span>
          </p>
        </div>
        <div className="panel divide-y divide-base-border">
          {drivers.length === 0 && <p className="p-4 text-sm text-ink-muted">No drivers yet.</p>}
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full overflow-hidden bg-base-border border border-base-border flex items-center justify-center shrink-0">
                  {d.photo_url ? (
                    <img src={d.photo_url} alt={d.full_name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg">👤</span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{d.full_name}</p>
                  <p className="text-xs text-ink-faint">{d.phone || "No phone on file"}</p>
                </div>
              </div>
              <span className={`text-xs font-mono ${d.status === "active" ? "text-risk-low" : "text-risk-veryhigh"}`}>
                {d.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
