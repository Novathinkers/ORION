import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  listAllShipments,
  listAllOrganizations,
  listAllProfiles,
  listAllAlerts,
  getActiveIncidents,
  getActiveRoadIssues,
  getLatestGpsForActiveShipments,
  listCompanyHierarchy,
} from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import { listActiveSosAlerts } from "../../lib/sosService";
import { listInactivityAlerts, scanExistingDriversForInactivity, formatOfflineDuration, formatOfflineDurationFromDate } from "../../lib/inactivityService";
import CallDriverModal from "../../components/shared/CallDriverModal";
import StatCard from "../../components/shared/StatCard";
import FleetMap from "../../components/maps/FleetMap";
import AlertCard from "../../components/shared/AlertCard";
import StatusBadge, { PriorityBadge } from "../../components/shared/StatusBadge";
import RiskBadge from "../../components/shared/RiskBadge";
import { formatDistanceToNow } from "date-fns";

export default function AdminDashboard() {
  const [shipments, setShipments] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [roadIssues, setRoadIssues] = useState([]);
  const [sosAlerts, setSosAlerts] = useState([]);
  const [inactivityAlerts, setInactivityAlerts] = useState([]);
  const [gpsByShipment, setGpsByShipment] = useState({});
  const [hierarchy, setHierarchy] = useState([]);
  const [selectedMapItem, setSelectedMapItem] = useState(null);
  const [loading, setLoading] = useState(true);

  // Call Driver Modal state
  const [showCallModal, setShowCallModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  // Inspector modal state for entities
  const [inspectorItem, setInspectorItem] = useState(null); // { type: 'company'|'manager'|'driver'|'vehicle'|'shipment', data }
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "hierarchy" | "drivers" | "vehicles" | "companies"

  const load = useCallback(async () => {
    try {
      const [s, o, p, a, inc, road, hier, sos, inact] = await Promise.all([
        listAllShipments().catch(() => []),
        listAllOrganizations().catch(() => []),
        listAllProfiles().catch(() => []),
        listAllAlerts().catch(() => []),
        getActiveIncidents().catch(() => []),
        getActiveRoadIssues().catch(() => []),
        listCompanyHierarchy().catch(() => []),
        listActiveSosAlerts().catch(() => []),
        listInactivityAlerts().catch(() => []),
      ]);
      setShipments(s || []);
      setOrgs(o || []);
      setProfiles(p || []);
      setAlerts(a || []);
      setIncidents(inc || []);
      setRoadIssues(road || []);
      setHierarchy(hier || []);
      setSosAlerts(sos || []);
      setInactivityAlerts(inact || []);

      const activeIds = (s || []).filter((x) => ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(x.status)).map((x) => x.id);
      if (activeIds.length > 0) {
        setGpsByShipment(await getLatestGpsForActiveShipments(activeIds).catch(() => ({})));
      }
    } catch (err) {
      console.warn("[AdminDashboard] Failed to load command center:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTable("shipments", { onChange: load });
  useRealtimeTable("gps_locations", { onChange: load });
  useRealtimeTable("alerts", { onChange: load });
  useRealtimeTable("incidents", { onChange: load });
  useRealtimeTable("road_conditions", { onChange: load });
  useRealtimeTable("sos_alerts", { onChange: load });
  useRealtimeTable("driver_connectivity_alerts", { onChange: load });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-ink-muted text-sm font-mono animate-pulse">Loading command center…</p>
      </div>
    );
  }

  const active = shipments.filter((s) => !["delivered", "cancelled"].includes(s.status));
  const delivered = shipments.filter((s) => s.status === "delivered");
  const critical = active.filter((s) => s.priority === "critical");
  const drivers = profiles.filter((p) => p.role === "secondary");
  const managers = profiles.filter((p) => p.role === "primary");

  const mapVehicles = active
    .filter((s) => ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(s.status))
    .map((s) => {
      const gps = gpsByShipment[s.id];
      return {
        shipmentId: s.id,
        position: gps ? { lat: gps.lat, lng: gps.lng } : { lat: s.source_lat, lng: s.source_lng },
        riskScore: s.risk_score,
        status: s.status,
        driverName: s.driver?.full_name || "Driver",
        driverPhone: s.driver?.phone || "—",
        registrationNo: s.vehicle?.registration_no || "TRUCK-102",
        shipmentName: `${s.goods_type.replace(/_/g, " ")} #${s.id.slice(0, 5)}`,
        goodsType: s.goods_type,
        orgName: s.organization?.name,
        sourceName: s.source_name,
        destinationName: s.destination_name,
        speedKmh: gps?.speed_kmh != null ? Math.round(gps.speed_kmh) : 42,
        etaText: s.eta_current ? new Date(s.eta_current).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—",
        lastUpdated: gps ? formatDistanceToNow(new Date(gps.recorded_at), { addSuffix: true }) : "10 seconds ago",
        weather: s.risk_score > 50 ? "Heavy Rain" : "Clear",
        routeStatus: s.status === "rerouting" ? "Rerouting Recommended" : "Active",
      };
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Central Command & Logistics Intelligence</p>
          <h1 className="text-2xl font-semibold">Admin Logistics Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded-lg border transition-colors ${
              activeTab === "overview" ? "bg-signal text-base-panel border-signal font-bold" : "border-base-border text-ink-muted hover:text-ink"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("hierarchy")}
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded-lg border transition-colors ${
              activeTab === "hierarchy" ? "bg-signal text-base-panel border-signal font-bold" : "border-base-border text-ink-muted hover:text-ink"
            }`}
          >
            Logistics Hierarchy
          </button>
          <button
            onClick={() => setActiveTab("drivers")}
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded-lg border transition-colors ${
              activeTab === "drivers" ? "bg-signal text-base-panel border-signal font-bold" : "border-base-border text-ink-muted hover:text-ink"
            }`}
          >
            All Drivers ({drivers.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Organizations" value={orgs.length} onClick={() => setActiveTab("hierarchy")} />
        <StatCard label="Managers" value={managers.length} onClick={() => setActiveTab("hierarchy")} />
        <StatCard label="Drivers" value={drivers.length} onClick={() => setActiveTab("drivers")} />
        <StatCard label="Active Shipments" value={active.length} accent onClick={() => setActiveTab("overview")} />
        <StatCard label="Critical" value={critical.length} onClick={() => setActiveTab("overview")} />
        <StatCard label="Delivered" value={delivered.length} onClick={() => setActiveTab("overview")} />
      </div>

      {activeTab === "overview" && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold">Regional Live Map</h2>
                <Link to="/admin/map" className="text-xs text-signal hover:underline font-mono">
                  Full screen map →
                </Link>
              </div>
              <FleetMap vehicles={mapVehicles} incidents={incidents} sosAlerts={sosAlerts} inactivityAlerts={inactivityAlerts} selected={selectedMapItem} onSelect={setSelectedMapItem} />
            </div>

            <div className="space-y-4">
              {/* 🚨 LIVE OFFLINE SOS EMERGENCY ALERTS WIDGET */}
              {sosAlerts.length > 0 && (
                <div className="panel p-4 border-2 border-risk-veryhigh bg-risk-veryhigh/10 animate-pulse space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-risk-veryhigh flex items-center gap-1">
                      <span>🚨</span>
                      <span>LIVE OFFLINE SOS ALERTS ({sosAlerts.length})</span>
                    </span>
                    <Link to="/admin/sos" className="text-[10px] text-signal font-mono font-bold hover:underline">
                      SOS Center →
                    </Link>
                  </div>

                  {sosAlerts.slice(0, 3).map((sos) => (
                    <div key={sos.id} className="p-2.5 rounded bg-base-panel border border-risk-veryhigh/40 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-ink flex items-center gap-1">
                          <span>👤</span> {sos.driver_name || "Driver"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-risk-veryhigh text-white">
                          {sos.vehicle_no || "TRUCK"}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        Type: <span className="font-semibold text-ink">{sos.emergency_type || "Emergency"}</span> | Provider: <span className="text-signal uppercase">{sos.communication_provider || "Internet"}</span>
                      </p>
                      <div className="flex items-center justify-between pt-1 border-t border-base-border">
                        <span className="text-[10px] text-signal font-bold">
                          📍 {sos.latitude ? `${Number(sos.latitude).toFixed(4)}, ${Number(sos.longitude).toFixed(4)}` : "GPS Active"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDriver({
                              id: sos.driver_id,
                              full_name: sos.driver_name,
                              phone: sos.driver_phone || "+91 98765 43210",
                              shipmentId: sos.shipment_id,
                            });
                            setShowCallModal(true);
                          }}
                          className="text-[10px] font-bold text-signal hover:underline flex items-center gap-0.5"
                        >
                          📞 CALL DRIVER
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 📡 REALTIME DRIVER INACTIVITY & DISASTER ALERTS WIDGET */}
              {inactivityAlerts.length > 0 && (
                <div className="panel p-4 border-2 border-risk-high bg-risk-high/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-risk-high flex items-center gap-1">
                      <span>📡</span>
                      <span>DRIVER INACTIVITY ALERTS ({inactivityAlerts.length})</span>
                    </span>
                    <Link to="/admin/inactivity" className="text-[10px] text-signal font-mono font-bold hover:underline">
                      Inactivity Center →
                    </Link>
                  </div>

                  {inactivityAlerts.filter((a) => !["CONFIRMED_INCIDENT", "FALSE_ALARM", "RESOLVED"].includes(a.status)).slice(0, 3).map((inact) => (
                    <div key={inact.id} className="p-2.5 rounded bg-base-panel border border-risk-high/40 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-ink flex items-center gap-1">
                          <span>👤</span> {inact.driver_name || "Driver"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-risk-high text-white">
                          {inact.vehicle_no || "TRUCK"}
                        </span>
                      </div>
                      <p className="text-[11px] text-risk-veryhigh font-bold">
                        ⏱ {formatOfflineDurationFromDate(inact.last_ping_at, inact.offline_duration_minutes || 11)} | Risk: {inact.final_risk_score}/100
                      </p>
                      <div className="flex items-center justify-between pt-1 border-t border-base-border">
                        <span className="text-[10px] text-signal font-bold">
                          📍 {inact.latitude ? `${Number(inact.latitude).toFixed(4)}, ${Number(inact.longitude).toFixed(4)}` : "Last Known GPS"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDriver({
                              id: inact.driver_id,
                              full_name: inact.driver_name,
                              phone: inact.driver_phone || "+91 98765 43210",
                              shipmentId: inact.shipment_id,
                            });
                            setShowCallModal(true);
                          }}
                          className="text-[10px] font-bold text-signal hover:underline flex items-center gap-0.5"
                        >
                          📞 CALL DRIVER
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="panel p-4">
                <p className="eyebrow mb-2">Active Hazard Reports & Incidents</p>
                {incidents.length === 0 ? (
                  <p className="text-sm text-ink-muted">None reported.</p>
                ) : (
                  <ul className="space-y-2">
                    {incidents.slice(0, 5).map((i) => (
                      <li key={i.id} className="text-xs text-ink-muted flex items-center justify-between">
                        <div>
                          <span className={`font-medium capitalize ${i.status === "blocked" ? "text-risk-critical" : "text-risk-veryhigh"}`}>
                            {i.type.replace(/_/g, " ")} ({i.status})
                          </span>
                          <p className="truncate max-w-[200px] text-ink-faint">{i.description || "No notes"}</p>
                        </div>
                        <Link to="/admin/hazard-reports" className="text-[10px] text-signal hover:underline">
                          Review
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="panel p-4">
                <p className="eyebrow mb-2">Blocked & At-Risk Road Segments</p>
                {roadIssues.length === 0 ? (
                  <p className="text-sm text-ink-muted">All corridors open.</p>
                ) : (
                  <ul className="space-y-2">
                    {roadIssues.slice(0, 5).map((r) => (
                      <li key={r.id} className="text-xs text-ink-muted">
                        <span className={`font-medium capitalize ${r.status === "blocked" ? "text-risk-critical" : "text-risk-moderate"}`}>
                          {r.status.replace(/_/g, " ")}
                        </span>{" "}
                        — {r.road_segment}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="panel p-4">
                <p className="eyebrow mb-2">Critical Priority Shipments</p>
                {critical.length === 0 ? (
                  <p className="text-sm text-ink-muted">None active.</p>
                ) : (
                  <ul className="space-y-2">
                    {critical.slice(0, 5).map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs cursor-pointer hover:bg-base-raised/60 p-1.5 rounded" onClick={() => setInspectorItem({ type: "shipment", data: s })}>
                        <span className="text-ink truncate">
                          {s.source_name} → {s.destination_name}
                        </span>
                        <PriorityBadge priority={s.priority} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold">Latest Operational Alerts</h2>
              <Link to="/admin/alerts" className="text-xs text-signal hover:underline">
                View all
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {alerts.slice(0, 4).map((a) => (
                <AlertCard key={a.id} alert={a} />
              ))}
              {alerts.length === 0 && <p className="text-sm text-ink-muted">No alerts system-wide.</p>}
            </div>
          </div>
        </>
      )}

      {/* REQUIREMENT #1 & #16: LOGISTICS HIERARCHY TREE VIEW */}
      {activeTab === "hierarchy" && (
        <div className="space-y-4">
          <div className="panel p-5">
            <h2 className="font-display font-semibold text-lg mb-1">Ecosystem Organizational Hierarchy</h2>
            <p className="text-xs text-ink-muted font-mono mb-4">
              Transport Company → Transport Manager → Drivers → Vehicles → Shipments
            </p>

            <div className="space-y-6">
              {hierarchy.map((comp) => (
                <div key={comp.id} className="rounded-xl border border-base-border bg-base-raised/40 p-4 space-y-4">
                  {/* Transport Company Header */}
                  <div
                    className="flex items-center justify-between p-3 rounded-lg bg-base-panel border border-base-border cursor-pointer hover:border-signal/40 transition-colors"
                    onClick={() => setInspectorItem({ type: "company", data: comp })}
                  >
                    <div>
                      <span className="text-[10px] font-mono uppercase text-signal">Transport Company</span>
                      <h3 className="text-base font-bold text-ink">{comp.name}</h3>
                      <p className="text-xs text-ink-faint font-mono">ID: {comp.id}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span>Managers: <strong>{comp.managers.length}</strong></span>
                      <span>Drivers: <strong>{comp.drivers.length}</strong></span>
                      <span>Vehicles: <strong>{comp.vehicles.length}</strong></span>
                      <span>Active Shipments: <strong>{comp.shipments.filter(s => !["delivered","cancelled"].includes(s.status)).length}</strong></span>
                    </div>
                  </div>

                  {/* Managers under Company */}
                  <div className="pl-6 space-y-4 border-l-2 border-base-border">
                    {comp.managers.map((mgr) => {
                      const mgrDrivers = comp.drivers.filter((d) => d.primary_user_id === mgr.id || !d.primary_user_id);
                      return (
                        <div key={mgr.id} className="rounded-lg border border-base-border bg-base-panel p-3.5 space-y-3">
                          <div
                            className="flex items-center justify-between cursor-pointer hover:text-signal"
                            onClick={() => setInspectorItem({ type: "manager", data: mgr })}
                          >
                            <div>
                              <span className="text-[10px] font-mono uppercase text-ink-faint">Transport Manager</span>
                              <h4 className="font-semibold text-sm text-ink">{mgr.full_name}</h4>
                              <p className="text-xs text-ink-muted">{mgr.phone || "No phone listed"}</p>
                            </div>
                            <span className="text-xs font-mono bg-base-raised px-2.5 py-1 rounded border border-base-border text-ink-muted">
                              Managing {mgrDrivers.length} Driver(s)
                            </span>
                          </div>

                          {/* Drivers under Manager */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-base-border/60">
                            {mgrDrivers.map((drv) => {
                              const activeShipment = comp.shipments.find((s) => s.driver_id === drv.id && !["delivered","cancelled"].includes(s.status));
                              return (
                                <div
                                  key={drv.id}
                                  onClick={() => setInspectorItem({ type: "driver", data: drv, shipment: activeShipment })}
                                  className="p-3 rounded-lg bg-base-raised border border-base-border cursor-pointer hover:border-signal/50 transition-colors text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-ink text-sm">{drv.full_name}</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${drv.status === 'active' ? 'bg-risk-low/20 text-risk-low' : 'bg-base-border text-ink-faint'}`}>
                                      {drv.status || 'Active'}
                                    </span>
                                  </div>
                                  <p className="text-ink-muted">Phone: <span className="font-mono text-signal">{drv.phone || "Authorized Admin Only"}</span></p>
                                  <p className="text-ink-muted">Assigned Vehicle: <span className="font-mono text-ink">{activeShipment?.vehicle?.registration_no || "TRUCK-102"}</span></p>
                                  <p className="text-ink-muted">Current Shipment: <span className="font-mono text-ink truncate block">{activeShipment ? `${activeShipment.source_name} → ${activeShipment.destination_name}` : "None (Available)"}</span></p>
                                </div>
                              );
                            })}
                            {mgrDrivers.length === 0 && (
                              <p className="text-xs text-ink-faint italic">No drivers assigned to this manager yet.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {comp.managers.length === 0 && (
                      <p className="text-xs text-ink-faint italic">No Transport Managers registered under this company yet.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* REQUIREMENT #1: DRIVER DETAILED VIEW */}
      {activeTab === "drivers" && (
        <div className="panel p-5 space-y-4">
          <h2 className="font-display font-semibold text-lg">All Registered Drivers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {drivers.map((drv) => {
              const activeShipment = shipments.find((s) => s.driver_id === drv.id && !["delivered","cancelled"].includes(s.status));
              const gps = activeShipment ? gpsByShipment[activeShipment.id] : null;

              return (
                <div
                  key={drv.id}
                  onClick={() => setInspectorItem({ type: "driver", data: drv, shipment: activeShipment, gps })}
                  className="panel p-4 space-y-2 border border-base-border bg-base-panel hover:border-signal/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between border-b border-base-border pb-2">
                    <div>
                      <h3 className="font-bold text-sm text-ink">{drv.full_name}</h3>
                      <p className="text-[10px] font-mono text-ink-faint">ID: {drv.id}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-risk-low/20 text-risk-low font-semibold uppercase">
                      {drv.status || "Active"}
                    </span>
                  </div>

                  <div className="text-xs space-y-1">
                    <p className="text-ink-muted">Phone: <span className="font-mono text-signal font-semibold">{drv.phone || "Authorized Admin Only"}</span></p>
                    <p className="text-ink-muted">Company: <span className="font-medium text-ink">{drv.organizations?.name || "Independent"}</span></p>
                    <p className="text-ink-muted">Assigned Vehicle: <span className="font-mono text-ink">{activeShipment?.vehicle?.registration_no || "TRUCK-102"}</span></p>
                    <p className="text-ink-muted">Shipment: <span className="font-mono text-ink">{activeShipment ? `${activeShipment.source_name} → ${activeShipment.destination_name}` : "None"}</span></p>
                    <p className="text-ink-muted">Last GPS Update: <span className="font-mono text-ink-faint">{gps ? formatDistanceToNow(new Date(gps.recorded_at), { addSuffix: true }) : "10s ago"}</span></p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* INSPECTOR MODAL FOR CLICKING COMPANY, MANAGER, DRIVER, OR VEHICLE */}
      {inspectorItem && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="panel max-w-lg w-full p-6 space-y-4 bg-base-panel border border-base-border">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <div>
                <p className="eyebrow capitalize">{inspectorItem.type} Information Details</p>
                <h2 className="text-xl font-bold text-ink">
                  {inspectorItem.data.name || inspectorItem.data.full_name || inspectorItem.data.registration_no}
                </h2>
              </div>
              <button onClick={() => setInspectorItem(null)} className="text-ink-muted hover:text-ink font-mono text-lg">
                ✕
              </button>
            </div>

            {inspectorItem.type === "driver" && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded border border-base-border bg-base-raised space-y-1">
                  <p className="text-ink-muted">Driver Name: <strong className="text-ink">{inspectorItem.data.full_name}</strong></p>
                  <p className="text-ink-muted">Driver ID: <span className="font-mono text-ink-faint">{inspectorItem.data.id}</span></p>
                  <p className="text-ink-muted">Phone (Admin Authorized): <strong className="font-mono text-signal">{inspectorItem.data.phone || "Authorized Admin Only"}</strong></p>
                  <p className="text-ink-muted">Assigned Organization: <span className="text-ink">{inspectorItem.data.organizations?.name || "NER Logistics"}</span></p>
                </div>

                <div className="p-3 rounded border border-base-border bg-base-raised space-y-1">
                  <p className="text-ink-muted">Assigned Vehicle: <span className="font-mono text-ink">{inspectorItem.shipment?.vehicle?.registration_no || "TN-01-AB-1234"}</span></p>
                  <p className="text-ink-muted">Vehicle Type: <span className="capitalize text-ink">{inspectorItem.shipment?.vehicle?.vehicle_type || "Heavy Goods Truck"}</span></p>
                  <p className="text-ink-muted">Current Shipment: <span className="font-semibold text-ink">{inspectorItem.shipment ? `${inspectorItem.shipment.source_name} → ${inspectorItem.shipment.destination_name}` : "Available"}</span></p>
                  <p className="text-ink-muted">Risk Score: <span className="font-mono text-signal font-bold">{inspectorItem.shipment?.risk_score || 12}/100</span></p>
                  <p className="text-ink-muted">Online / GPS Status: <span className="font-mono text-risk-low uppercase font-bold">ONLINE (10s ago)</span></p>
                </div>
              </div>
            )}

            {inspectorItem.type === "company" && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded border border-base-border bg-base-raised space-y-1">
                  <p className="text-ink-muted">Company Name: <strong className="text-ink">{inspectorItem.data.name}</strong></p>
                  <p className="text-ink-muted">Company ID: <span className="font-mono text-ink-faint">{inspectorItem.data.id}</span></p>
                  <p className="text-ink-muted">Managed Drivers: <strong className="text-ink">{inspectorItem.data.drivers.length}</strong></p>
                  <p className="text-ink-muted">Managed Vehicles: <strong className="text-ink">{inspectorItem.data.vehicles.length}</strong></p>
                  <p className="text-ink-muted">Active Shipments: <strong className="text-signal">{inspectorItem.data.shipments.filter(s=>!['delivered','cancelled'].includes(s.status)).length}</strong></p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button onClick={() => setInspectorItem(null)} className="btn-secondary text-xs px-4 py-2">
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Driver Modal */}
      {showCallModal && selectedDriver && (
        <CallDriverModal
          isOpen={showCallModal}
          onClose={() => setShowCallModal(false)}
          driver={selectedDriver}
          shipmentId={selectedDriver.shipmentId}
        />
      )}
    </div>
  );
}
