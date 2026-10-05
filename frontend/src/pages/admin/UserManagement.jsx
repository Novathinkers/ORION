import { useEffect, useState, useCallback } from "react";
import { listAllProfiles, listAllShipments, listAllOrganizations, setUserStatus, getLatestGpsForActiveShipments } from "../../lib/dataService";
import { formatDistanceToNow } from "date-fns";

export default function UserManagement() {
  const [profiles, setProfiles] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [gpsByShipment, setGpsByShipment] = useState({});
  const [tab, setTab] = useState("primary");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, s, o] = await Promise.all([listAllProfiles(), listAllShipments(), listAllOrganizations()]);
    setProfiles(p);
    setShipments(s);
    setOrgs(o);
    const activeIds = s.filter((x) => ["in_transit", "delayed", "rerouting"].includes(x.status)).map((x) => x.id);
    setGpsByShipment(await getLatestGpsForActiveShipments(activeIds));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (userId, current) => {
    await setUserStatus(userId, current === "active" ? "inactive" : "active");
    await load();
  };

  const primaryUsers = profiles.filter((p) => p.role === "primary");
  const secondaryUsers = profiles.filter((p) => p.role === "secondary");

  if (loading) return <p className="text-ink-muted text-sm font-mono">Loading users…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">User Management</h1>
        <p className="text-sm text-ink-muted">{orgs.length} organizations · {primaryUsers.length} managers · {secondaryUsers.length} drivers</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab("primary")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "primary" ? "bg-signal/10 text-signal border border-signal/40" : "text-ink-muted border border-base-border"}`}>Primary Users</button>
        <button onClick={() => setTab("secondary")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "secondary" ? "bg-signal/10 text-signal border border-signal/40" : "text-ink-muted border border-base-border"}`}>Secondary Users</button>
      </div>

      {tab === "primary" && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint uppercase tracking-wide border-b border-base-border">
                <th className="p-3">Name</th>
                <th className="p-3">Organization</th>
                <th className="p-3">Vehicles</th>
                <th className="p-3">Active Shipments</th>
                <th className="p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {primaryUsers.map((u) => {
                const orgShipments = shipments.filter((s) => s.organization_id === u.organization_id);
                const active = orgShipments.filter((s) => !["delivered", "cancelled"].includes(s.status));
                return (
                  <tr key={u.id} className="border-b border-base-border last:border-0">
                    <td className="p-3">{u.full_name}</td>
                    <td className="p-3 text-ink-muted">{u.organizations?.name}</td>
                    <td className="p-3 text-ink-muted">—</td>
                    <td className="p-3 text-ink-muted">{active.length}</td>
                    <td className="p-3">
                      <span className={u.status === "active" ? "text-risk-low text-xs" : "text-risk-veryhigh text-xs"}>{u.status}</span>
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => toggleStatus(u.id, u.status)} className="btn-secondary text-xs px-3 py-1.5">
                        {u.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "secondary" && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint uppercase tracking-wide border-b border-base-border">
                <th className="p-3">Name</th>
                <th className="p-3">Manager</th>
                <th className="p-3">Current Shipment</th>
                <th className="p-3">Current Location</th>
                <th className="p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {secondaryUsers.map((u) => {
                const currentShipment = shipments.find((s) => s.driver_id === u.id && !["delivered", "cancelled"].includes(s.status));
                const manager = primaryUsers.find((p) => p.id === u.primary_user_id);
                const gps = currentShipment ? gpsByShipment[currentShipment.id] : null;
                return (
                  <tr key={u.id} className="border-b border-base-border last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full overflow-hidden bg-base-border border border-base-border flex items-center justify-center shrink-0">
                          {u.photo_url ? (
                            <img src={u.photo_url} alt={u.full_name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-sm">👤</span>
                          )}
                        </div>
                        <span>{u.full_name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-ink-muted">{manager?.full_name || "—"}</td>
                    <td className="p-3 text-ink-muted truncate max-w-[200px]">
                      {currentShipment ? `${currentShipment.source_name} → ${currentShipment.destination_name}` : "None"}
                    </td>
                    <td className="p-3 text-ink-muted font-mono text-xs">
                      {gps ? `${gps.lat.toFixed(3)}, ${gps.lng.toFixed(3)} (${formatDistanceToNow(new Date(gps.recorded_at), { addSuffix: true })})` : "—"}
                    </td>
                    <td className="p-3">
                      <span className={u.status === "active" ? "text-risk-low text-xs" : "text-risk-veryhigh text-xs"}>{u.status}</span>
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => toggleStatus(u.id, u.status)} className="btn-secondary text-xs px-3 py-1.5">
                        {u.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
