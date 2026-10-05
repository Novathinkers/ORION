import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  listAllHazardReports,
  markDangerZone,
  markRoadBlocked,
  dismissHazardReport,
  deleteRoadBlock,
  listAllShipments,
  updateShipment,
} from "../../lib/dataService";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import { pathIntersectsZone } from "../../lib/dangerZoneService";
import { scoreRouteOption, chooseBestRoute } from "../../lib/riskEngine";
import CallDriverModal from "../../components/shared/CallDriverModal";
import RouteMap from "../../components/maps/RouteMap";

const SEVERITY_COLOR = {
  LOW: "text-risk-low border-risk-low/30 bg-risk-low/10",
  MODERATE: "text-risk-moderate border-risk-moderate/30 bg-risk-moderate/10",
  HIGH: "text-risk-high border-risk-high/30 bg-risk-high/10",
  CRITICAL: "text-risk-critical border-risk-critical/30 bg-risk-critical/10",
  low: "text-risk-low border-risk-low/30 bg-risk-low/10",
  moderate: "text-risk-moderate border-risk-moderate/30 bg-risk-moderate/10",
  high: "text-risk-high border-risk-high/30 bg-risk-high/10",
  very_high: "text-risk-veryhigh border-risk-veryhigh/30 bg-risk-veryhigh/10",
  critical: "text-risk-critical border-risk-critical/30 bg-risk-critical/10",
};

export default function HazardReports() {
  const { user, role, profile } = useAuth();
  const orgId = profile?.organization_id;

  const [reports, setReports] = useState([]);
  const [activeTab, setActiveTab] = useState("all"); // "all" | "pending" | "blocked" | "active" | "dismissed"
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [radiusByReport, setRadiusByReport] = useState({});
  const [radiusUnitByReport, setRadiusUnitByReport] = useState({});
  const [radiusValueByReport, setRadiusValueByReport] = useState({});
  const [affected, setAffected] = useState([]);
  const [callTarget, setCallTarget] = useState(null);

  // Inspection & Confirmation Modals
  const [viewReport, setViewReport] = useState(null);
  const [viewImage, setViewImage] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'reject'|'activate'|'block', report: object }
  const [actionProcessing, setActionProcessing] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const isAdmin = role === "admin";
  const isManager = role === "primary";
  const isDriver = role === "secondary";

  const load = useCallback(async () => {
    if (!user) return;
    const data = await listAllHazardReports({ role, userId: user.id, orgId });
    setReports(data || []);
  }, [role, user, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTable("incidents", { onChange: load });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // --- CONFIRMED ADMIN ACTION: REJECT REPORT ---
  const executeReject = async (report) => {
    setActionProcessing(true);
    try {
      await dismissHazardReport(report.id, user.id);
      showToast("❌ Hazard Report Marked as Rejected");
      setReports((prev) =>
        prev.map((item) => (item.id === report.id ? { ...item, status: "dismissed" } : item))
      );
      await load();
      if (viewReport?.id === report.id) {
        setViewReport((prev) => (prev ? { ...prev, status: "dismissed" } : prev));
      }
    } catch (err) {
      alert("❌ Unable to reject report: " + err.message);
    } finally {
      setActionProcessing(false);
      setConfirmAction(null);
    }
  };

  // --- CONFIRMED ADMIN ACTION: MARK AS ACTIVE DANGER ZONE ---
  const executeMarkActive = async (report) => {
    setActionProcessing(true);
    try {
      const radiusKm = radiusByReport[report.id] ?? 5;
      await markDangerZone(report.id, { radiusKm, reviewedBy: user.id });

      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id ? { ...item, status: "active", is_danger_zone: true, radius_km: radiusKm } : item
        )
      );

      const zone = { lat: report.lat, lng: report.lng, radius_km: radiusKm };
      const allShipments = await listAllShipments();
      const hit = allShipments.filter((s) => {
        const active = ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(s.status);
        if (!active) return false;
        const recPath = s.route_json?.overviewPath;
        const altPath = s.alternate_route_json?.overviewPath;
        return pathIntersectsZone(recPath, zone) || pathIntersectsZone(altPath, zone);
      });
      setAffected(hit);
      showToast("⚠ Hazard Marked as Active Danger Zone");
      await load();
      if (viewReport?.id === report.id) {
        setViewReport((prev) => (prev ? { ...prev, status: "active", is_danger_zone: true, radius_km: radiusKm } : prev));
      }
    } catch (err) {
      alert("❌ Unable to activate hazard: " + err.message);
    } finally {
      setActionProcessing(false);
      setConfirmAction(null);
    }
  };

  // --- CONFIRMED ADMIN ACTION: MARK ROAD AS BLOCKED ---
  const executeMarkRoadBlocked = async (report) => {
    setActionProcessing(true);
    try {
      const radiusKm = radiusByReport[report.id] ?? 5;
      const roadSegment = `${report.ai_analysis?.hazard || report.type || "Corridor"} Segment (${report.lat.toFixed(2)}°, ${report.lng.toFixed(2)}°)`;

      await markRoadBlocked(report.id, { radiusKm, reviewedBy: user.id, roadSegment });

      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id ? { ...item, status: "blocked", is_danger_zone: true, radius_km: radiusKm } : item
        )
      );

      const zone = { lat: report.lat, lng: report.lng, radius_km: radiusKm };
      const allShipments = await listAllShipments();
      const hit = [];

      for (const s of allShipments) {
        const active = ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(s.status);
        if (!active) continue;

        const recPath = s.route_json?.overviewPath;
        const intersects = pathIntersectsZone(recPath, zone);

        if (intersects) {
          hit.push(s);
          try {
            const recScored = await scoreRouteOption({
              route: s.route_json || { overviewPath: recPath, distanceKm: s.distance_km || 100, durationMin: 120 },
              routeWeather: null,
              hazardSummary: { avgScore: 80, explanation: "Confirmed Road Blockage", dominantTerrain: "mixed" },
              nearbyIncidents: [{ type: report.type, severity: "critical", status: "blocked" }],
              roadStatus: "blocked",
              activeDangerZones: [zone],
              priority: s.priority,
            });

            let alternateOption = null;
            if (s.alternate_route_json) {
              alternateOption = await scoreRouteOption({
                route: s.alternate_route_json,
                routeWeather: null,
                hazardSummary: { avgScore: 10, explanation: "Safe detour", dominantTerrain: "plain" },
                nearbyIncidents: [],
                roadStatus: "open",
                activeDangerZones: [],
                priority: s.priority,
              });
            }

            const routeOptions = [{ key: "recommended", ...recScored }];
            if (alternateOption) routeOptions.push({ key: "alternate", ...alternateOption });

            chooseBestRoute(routeOptions);

            await updateShipment(s.id, {
              status: "rerouting",
              risk_score: recScored.risk.score,
              risk_level: recScored.risk.level,
              risk_explanation: `ROAD BLOCKED: ${recScored.risk.explanation}. Detour search initiated.`,
            });
          } catch {
            await updateShipment(s.id, {
              status: "rerouting",
              risk_score: 85,
              risk_level: "CRITICAL",
              risk_explanation: "ROAD BLOCKED: Confirmed blockage on corridor segment. Driver re-routing requested.",
            });
          }
        }
      }

      setAffected(hit);
      showToast("🔴 Road Successfully Marked as Blocked");
      await load();
      if (viewReport?.id === report.id) {
        setViewReport((prev) => (prev ? { ...prev, status: "blocked", is_danger_zone: true, radius_km: radiusKm } : prev));
      }
    } catch (err) {
      alert("❌ Unable to mark road as blocked: " + err.message);
    } finally {
      setActionProcessing(false);
      setConfirmAction(null);
    }
  };

  // --- CONFIRMED ADMIN ACTION: DELETE ROAD BLOCK ---
  const executeDeleteRoadBlock = async (report) => {
    setActionProcessing(true);
    try {
      await deleteRoadBlock(report.id, user.id);
      showToast("🗑 Road Blockage Successfully Removed & Deleted");
      setReports((prev) =>
        prev.map((item) => (item.id === report.id ? { ...item, status: "dismissed", is_danger_zone: false } : item))
      );
      await load();
      if (viewReport?.id === report.id) {
        setViewReport((prev) => (prev ? { ...prev, status: "dismissed", is_danger_zone: false } : prev));
      }
    } catch (err) {
      alert("❌ Unable to delete road block: " + err.message);
    } finally {
      setActionProcessing(false);
      setConfirmAction(null);
    }
  };

  const playMultiLangAudio = (text, lang = "en-IN") => {
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  // Filtering
  const pendingCount = reports.filter((r) => r.status === "pending_review").length;
  const activeCount = reports.filter((r) => r.is_danger_zone && r.status === "active").length;
  const blockedCount = reports.filter((r) => r.status === "blocked").length;
  const dismissedCount = reports.filter((r) => r.status === "dismissed" || r.status === "rejected").length;

  const filteredReports = reports.filter((r) => {
    if (activeTab === "pending" && r.status !== "pending_review") return false;
    if (activeTab === "active" && !(r.is_danger_zone && r.status === "active")) return false;
    if (activeTab === "blocked" && r.status !== "blocked") return false;
    if (activeTab === "dismissed" && r.status !== "dismissed" && r.status !== "rejected") return false;

    if (categoryFilter !== "all" && r.type !== categoryFilter && r.ai_analysis?.category !== categoryFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (r.reporter?.full_name || "").toLowerCase();
      const desc = (r.description || "").toLowerCase();
      const hazard = (r.ai_analysis?.hazard || r.type || "").toLowerCase();
      const expl = (r.ai_analysis?.explanation || "").toLowerCase();
      if (!name.includes(q) && !desc.includes(q) && !hazard.includes(q) && !expl.includes(q)) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Toast Banner */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-[9999] bg-base-panel border border-signal/40 shadow-2xl px-4 py-3 rounded-xl text-sm font-semibold text-signal flex items-center gap-2 animate-bounce">
          <span>✔</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Role Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Logistics & Hazard Control</p>
          <h1 className="text-2xl font-semibold">
            {isAdmin
              ? "Admin Hazard Reports & Road Block Command Center"
              : isManager
              ? "Managed Drivers' Hazard Reports & Route Alerts"
              : "My Submitted Hazard Reports & Admin Decisions"}
          </h1>
          <p className="text-sm text-ink-muted">
            {isAdmin
              ? "Full authority to review driver evidence, listen to voice recordings, inspect AI triage, and confirm road blockages."
              : isManager
              ? "Review hazard submissions from drivers under your management scope. (View-Only Access)"
              : "Track the review status and official Admin decisions for hazard reports you have submitted from the field."}
          </p>
        </div>

        {isDriver && (
          <Link to="/driver/report-hazard" className="btn-primary">
            + Report New Hazard
          </Link>
        )}
      </div>

      {/* Affected Active Shipments Alert Banner (Admin & Manager) */}
      {!isDriver && affected.length > 0 && (
        <div className="panel p-4 border-risk-critical/40 bg-risk-critical/10 space-y-2">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-risk-critical font-bold">⛔ Road Blockage / Danger Zone Confirmed — Affected Active Shipments</p>
            <span className="text-xs font-mono text-ink-muted">{affected.length} shipment(s) impacted</span>
          </div>
          {affected.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-base-border/50 last:border-none">
              <div>
                <span className="font-semibold text-ink">
                  {s.source_name} → {s.destination_name}
                </span>
                <span className="text-ink-muted text-xs ml-2">· Driver: {s.driver?.full_name || "Unassigned"} · Status: {s.status}</span>
              </div>
              <button onClick={() => setCallTarget(s)} className="btn-secondary text-xs px-3 py-1.5 border-risk-critical/40 text-risk-critical">
                📞 Call Driver Immediately
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-base-border pb-2 flex-wrap">
        <button
          onClick={() => setActiveTab("all")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
            activeTab === "all"
              ? "bg-signal text-base-panel border-signal font-bold"
              : "border-base-border text-ink-muted hover:text-ink"
          }`}
        >
          <span>All Reports ({reports.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("pending")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
            activeTab === "pending"
              ? "bg-signal text-base-panel border-signal font-bold"
              : "border-base-border text-ink-muted hover:text-ink"
          }`}
        >
          <span>Pending Review</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 font-mono">{pendingCount}</span>
        </button>

        <button
          onClick={() => setActiveTab("blocked")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
            activeTab === "blocked"
              ? "bg-risk-critical text-white border-risk-critical font-bold"
              : "border-base-border text-ink-muted hover:text-ink"
          }`}
        >
          <span>⛔ Blocked Roads</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 font-mono">{blockedCount}</span>
        </button>

        <button
          onClick={() => setActiveTab("active")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
            activeTab === "active"
              ? "bg-signal text-base-panel border-signal font-bold"
              : "border-base-border text-ink-muted hover:text-ink"
          }`}
        >
          <span>Active Danger Zones</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 font-mono">{activeCount}</span>
        </button>

        <button
          onClick={() => setActiveTab("dismissed")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
            activeTab === "dismissed"
              ? "bg-signal text-base-panel border-signal font-bold"
              : "border-base-border text-ink-muted hover:text-ink"
          }`}
        >
          <span>Dismissed / Rejected</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 font-mono">{dismissedCount}</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="panel p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-[200px]">
          <label className="text-xs font-mono text-ink-muted">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-base-raised border border-base-border rounded px-2.5 py-1.5 text-xs text-ink focus:outline-none"
          >
            <option value="all">All Categories</option>
            <option value="landslide">Landslide & Rockfall</option>
            <option value="flood">Flooding & Waterlogging</option>
            <option value="damaged_road">Damaged Road</option>
            <option value="blocked_road">Blocked Road</option>
            <option value="fallen_tree">Fallen Tree</option>
            <option value="accident">Accident / Obstruction</option>
            <option value="debris">Debris</option>
          </select>
        </div>

        <div className="flex-1 min-w-[220px]">
          <input
            type="text"
            placeholder="Search report by driver name, hazard, description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-base-raised border border-base-border rounded px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-signal/50"
          />
        </div>
      </div>

      {/* Empty State */}
      {filteredReports.length === 0 && (
        <div className="panel p-8 text-center text-ink-faint">
          <p className="text-sm">No hazard reports found in this view.</p>
        </div>
      )}

      {/* Hazard Report Cards */}
      <div className="space-y-5">
        {filteredReports.map((r) => {
          const ai = r.ai_analysis || {};
          const confidencePct =
            ai.confidence != null
              ? ai.confidence > 1
                ? Math.round(ai.confidence)
                : Math.round(ai.confidence * 100)
              : 92;

          const isPending = r.status === "pending_review";
          const isBlocked = r.status === "blocked";
          const isActiveZone = r.is_danger_zone && r.status === "active";
          const isDismissed = r.status === "dismissed";

          return (
            <div key={r.id} className="panel p-5 space-y-4 shadow-panel">
              <div className="flex flex-col md:flex-row gap-5">
                {/* Uploaded Driver Photograph / Hazard Photo Area */}
                {r.image_url ? (
                  <div className="w-full md:w-56 shrink-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase font-mono tracking-wider text-ink-faint">📷 Uploaded Driver Image</p>
                      <button
                        onClick={() => setViewImage(r.image_url)}
                        className="text-[10px] text-signal hover:underline font-mono"
                      >
                        🔍 Expand Photo
                      </button>
                    </div>
                    <div className="relative group rounded-lg overflow-hidden border border-base-border bg-black/40">
                      <img
                        src={r.image_url}
                        alt="Uploaded Driver Hazard"
                        onClick={() => setViewImage(r.image_url)}
                        className="w-full h-44 object-cover rounded-lg border border-base-border cursor-pointer group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur border border-white/20 pointer-events-none">
                        Driver Photo Evidence
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full md:w-56 shrink-0 h-44 rounded-lg border border-base-border bg-base-raised/60 flex flex-col items-center justify-center p-3 text-center space-y-1">
                    <span className="text-xl text-ink-faint">📷</span>
                    <p className="text-xs font-medium text-ink-muted">No photo uploaded</p>
                    <p className="text-[10px] text-ink-faint">Driver submitted report without photo</p>
                  </div>
                )}

                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded ${
                            isBlocked
                              ? "bg-risk-critical/20 text-risk-critical border border-risk-critical/40"
                              : isPending
                              ? "bg-risk-moderate/20 text-risk-moderate border border-risk-moderate/30"
                              : isActiveZone
                              ? "bg-risk-high/20 text-risk-high border border-risk-high/30"
                              : "bg-base-border text-ink-muted"
                          }`}
                        >
                          {isBlocked ? "⛔ ROAD BLOCKED" : isPending ? "PENDING REVIEW" : isActiveZone ? "ACTIVE DANGER ZONE" : "REJECTED / DISMISSED"}
                        </span>
                        <span className="text-xs text-ink-faint font-mono">
                          {new Date(r.created_at).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      <h3 className="font-display font-semibold text-lg capitalize text-ink">
                        {ai.hazard || r.type.replace(/_/g, " ")}
                      </h3>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-xs font-mono uppercase font-semibold px-2.5 py-1 rounded border ${
                          SEVERITY_COLOR[ai.severity || r.severity] || "text-risk-high border-risk-high/30 bg-risk-high/10"
                        }`}
                      >
                        Severity: {ai.severity || r.severity}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg border border-base-border bg-base-raised p-3 text-xs">
                    <div>
                      <p className="text-ink-faint">AI Confidence</p>
                      <p className="font-mono text-signal font-semibold text-sm">{confidencePct}%</p>
                    </div>
                    <div>
                      <p className="text-ink-faint">Reported By</p>
                      <p className="font-medium text-ink truncate">{r.reporter?.full_name || "Driver"}</p>
                      <p className="text-[10px] text-ink-faint font-mono">{r.reporter?.phone || ""}</p>
                    </div>
                    <div>
                      <p className="text-ink-faint">Affected Radius</p>
                      <p className="font-mono text-ink font-semibold">
                        {(() => {
                          const km = radiusByReport[r.id] ?? r.radius_km ?? 5;
                          return km < 1 ? `${Math.round(km * 1000)} m (${km} km)` : `${km} km`;
                        })()}
                      </p>
                    </div>
                  </div>

                  {/* ADMIN VOICE PLAYBACK PLAYER (Multi-Language Real Audio Sound + Speech Synthesis) */}
                  {r.voice_url || r.ai_analysis?.voice_url ? (
                    <div className="p-3.5 rounded-xl border border-signal/40 bg-signal/10 space-y-2">
                      <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                        <span className="font-mono font-bold text-signal flex items-center gap-2">
                          <span>🎙</span> DRIVER VOICE REPORT (REAL AUDIO SOUND)
                        </span>
                        <span className="text-[10px] font-mono text-ink-muted bg-base-panel/80 px-2 py-0.5 rounded border border-base-border">
                          Audio File: {r.voice_url?.startsWith("data:") ? "Voice Recording" : "Supabase Cloud Audio"}
                        </span>
                      </div>
                      <audio
                        src={r.voice_url || r.ai_analysis?.voice_url}
                        controls
                        className="w-full h-10 mt-1 rounded-lg border border-signal/30"
                      />
                    </div>
                  ) : r.description ? (
                    <div className="p-3.5 rounded-xl border border-signal/30 bg-signal/5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                        <span className="font-mono font-bold text-signal flex items-center gap-2">
                          <span>🎙</span> DRIVER VOICE REPORT (MULTI-LANGUAGE SOUND)
                        </span>
                        <div className="flex items-center gap-1.5 bg-base-panel p-1 rounded-lg border border-base-border">
                          <button
                            type="button"
                            onClick={() => playMultiLangAudio(r.description, "en-IN")}
                            className="px-2 py-0.5 text-[10px] font-mono rounded bg-signal/15 text-signal hover:bg-signal/30 font-bold flex items-center gap-1"
                          >
                            <span>🇬🇧</span> English
                          </button>
                          <button
                            type="button"
                            onClick={() => playMultiLangAudio(r.description, "hi-IN")}
                            className="px-2 py-0.5 text-[10px] font-mono rounded bg-risk-high/15 text-risk-high hover:bg-risk-high/30 font-bold flex items-center gap-1"
                          >
                            <span>🇮🇳</span> हिन्दी
                          </button>
                          <button
                            type="button"
                            onClick={() => playMultiLangAudio(r.description, "ta-IN")}
                            className="px-2 py-0.5 text-[10px] font-mono rounded bg-risk-low/15 text-risk-low hover:bg-risk-low/30 font-bold flex items-center gap-1"
                          >
                            <span>🇮🇳</span> தமிழ்
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-ink bg-base-panel/60 p-2.5 rounded border border-base-border font-sans">
                        "{r.description}"
                      </p>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg border border-base-border bg-base-raised/50 text-xs text-ink-faint italic flex items-center gap-2">
                      <span>🎙</span> No audio recording attached with this hazard report.
                    </div>
                  )}

                  {/* AI Analysis */}
                  {ai.explanation && (
                    <div>
                      <p className="text-[10px] uppercase font-mono tracking-wider text-ink-faint mb-1">🤖 AI Analysis & Reasoning</p>
                      <p className="text-xs text-ink-muted bg-base-raised p-2.5 rounded border border-base-border">
                        {ai.explanation}
                      </p>
                    </div>
                  )}

                  {r.description && (
                    <div>
                      <p className="text-[10px] uppercase font-mono tracking-wider text-ink-faint mb-1">Driver Text Description</p>
                      <p className="text-xs text-ink">{r.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Map location */}
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-mono tracking-wider text-ink-faint">
                  📍 Location Coordinates: {r.lat.toFixed(4)}°, {r.lng.toFixed(4)}°
                </p>
                <div className="h-36 rounded-lg overflow-hidden border border-base-border">
                  <RouteMap
                    source={{ lat: r.lat, lng: r.lng }}
                    destination={{ lat: r.lat, lng: r.lng }}
                    current={{ lat: r.lat, lng: r.lng }}
                    incidents={[r]}
                    height={144}
                  />
                </div>
              </div>

              {/* Action Toolbar & Duplicate Action Prevention (Requirement #7 & #8) */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-base-border bg-base-raised/50 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewReport(r)}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                  >
                    <span>🔍</span> View Full Details
                  </button>

                  {isAdmin && (
                    <div className="flex items-center gap-1.5 bg-base-raised p-1 rounded-lg border border-base-border">
                      <label className="text-[10px] font-mono uppercase text-ink-muted px-1">Radius:</label>
                      <input
                        type="number"
                        step={radiusUnitByReport[r.id] === "m" ? "50" : "0.1"}
                        min="1"
                        placeholder="Radius..."
                        value={
                          radiusValueByReport[r.id] !== undefined
                            ? radiusValueByReport[r.id]
                            : (radiusUnitByReport[r.id] === "m" ? (r.radius_km || radiusByReport[r.id] || 5) * 1000 : (r.radius_km || radiusByReport[r.id] || 5))
                        }
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const unit = radiusUnitByReport[r.id] || "km";
                          setRadiusValueByReport((p) => ({ ...p, [r.id]: val }));
                          const kmVal = unit === "m" ? val / 1000 : val;
                          setRadiusByReport((p) => ({ ...p, [r.id]: kmVal }));
                        }}
                        className="w-20 bg-base-panel border border-base-border rounded px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:border-signal font-bold"
                      />
                      <select
                        value={radiusUnitByReport[r.id] || "km"}
                        onChange={(e) => {
                          const newUnit = e.target.value;
                          const currentVal = radiusValueByReport[r.id] ?? (r.radius_km || radiusByReport[r.id] || 5);
                          let convertedVal = currentVal;
                          if (newUnit === "m" && (radiusUnitByReport[r.id] || "km") === "km") {
                            convertedVal = currentVal * 1000;
                          } else if (newUnit === "km" && (radiusUnitByReport[r.id] || "km") === "m") {
                            convertedVal = currentVal / 1000;
                          }
                          setRadiusUnitByReport((p) => ({ ...p, [r.id]: newUnit }));
                          setRadiusValueByReport((p) => ({ ...p, [r.id]: convertedVal }));
                          const kmVal = newUnit === "m" ? convertedVal / 1000 : convertedVal;
                          setRadiusByReport((p) => ({ ...p, [r.id]: kmVal }));
                        }}
                        className="bg-base-panel border border-base-border rounded px-1.5 py-1 text-xs font-mono font-bold text-signal"
                      >
                        <option value="km">km</option>
                        <option value="m">m</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* ADMIN EXPLICIT ACTION BUTTONS WITH CONFIRMATION & DUPLICATE ACTION PREVENTION */}
                {isAdmin ? (
                  <div className="flex items-center gap-2">
                    {isPending ? (
                      <>
                        <button
                          onClick={() => setConfirmAction({ type: "reject", report: r })}
                          className="btn-secondary text-xs px-3 py-1.5 border-base-border hover:border-risk-veryhigh/50 text-ink-muted hover:text-risk-veryhigh"
                        >
                          [Reject]
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: "activate", report: r })}
                          className="btn-secondary text-xs px-3.5 py-1.5 text-signal border-signal/40 bg-signal/5 hover:bg-signal/15 font-semibold"
                        >
                          [Mark as Active]
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: "block", report: r })}
                          className="btn-danger text-xs px-4 py-1.5 font-bold shadow-sm"
                        >
                          ⛔ [Mark Road as Blocked]
                        </button>
                      </>
                    ) : isBlocked ? (
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-risk-critical/20 text-risk-critical border border-risk-critical/40">
                          ✓ [Road Blocked]
                        </span>
                        <button
                          onClick={() => setConfirmAction({ type: "delete_block", report: r })}
                          className="btn-secondary text-xs px-3 py-1.5 text-risk-veryhigh border-risk-veryhigh/40 hover:bg-risk-veryhigh/10 font-bold flex items-center gap-1"
                        >
                          <span>🗑</span> Delete Road Block
                        </button>
                      </div>
                    ) : isActiveZone ? (
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-signal/20 text-signal border border-signal/40">
                          ✓ [Active Danger Zone]
                        </span>
                        <button
                          onClick={() => setConfirmAction({ type: "reject", report: r })}
                          className="btn-secondary text-xs px-3 py-1.5 text-risk-veryhigh border-risk-veryhigh/40 hover:bg-risk-veryhigh/10 font-bold flex items-center gap-1"
                        >
                          <span>🗑</span> Delete / Reject
                        </button>
                      </div>
                    ) : (
                      <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-base-border text-ink-muted">
                        ❌ [Report Rejected]
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs font-mono text-ink-faint flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-signal/60" />
                    <span>Admin Decision: <strong className="uppercase text-ink">{r.status.replace(/_/g, " ")}</strong></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CONFIRMATION DIALOG MODAL (Requirement #7 & #8) */}
      {confirmAction && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="panel max-w-md w-full p-6 space-y-4 bg-base-panel border border-base-border shadow-2xl">
            <div className="flex items-center gap-3 border-b border-base-border pb-3">
              <span className="text-2xl">
                {confirmAction.type === "block" ? "⛔" : confirmAction.type === "activate" ? "⚠️" : "🗑"}
              </span>
              <div>
                <h3 className="font-bold text-lg text-ink">
                  {confirmAction.type === "block"
                    ? "⚠ Mark Road as Blocked?"
                    : confirmAction.type === "activate"
                    ? "Activate Hazard?"
                    : confirmAction.type === "delete_block"
                    ? "Delete Road Blockage & Unblock Road?"
                    : "Reject Hazard Report?"}
                </h3>
                <p className="text-xs text-ink-muted font-mono">
                  Report ID: {confirmAction.report.id.slice(0, 8)}
                </p>
              </div>
            </div>

            <p className="text-sm text-ink leading-relaxed">
              {confirmAction.type === "block"
                ? "This action will officially set the road status to BLOCKED, trigger AI/ML route re-evaluation, and reroute affected active shipments."
                : confirmAction.type === "activate"
                ? "This action will set the hazard status to ACTIVE, include it in riskEngine calculations, and alert managers."
                : confirmAction.type === "delete_block"
                ? "This action will permanently remove the road blockage from Supabase database, unblock the highway corridor, and clear hazard restrictions."
                : "This report will be marked as REJECTED and removed from active hazard calculations."}
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-base-border">
              <button
                disabled={actionProcessing}
                onClick={() => setConfirmAction(null)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Cancel
              </button>

              {confirmAction.type === "block" && (
                <button
                  disabled={actionProcessing}
                  onClick={() => executeMarkRoadBlocked(confirmAction.report)}
                  className="btn-danger text-xs px-5 py-2 font-bold"
                >
                  {actionProcessing ? "Marking Road Blocked..." : "Confirm Road Block"}
                </button>
              )}

              {confirmAction.type === "activate" && (
                <button
                  disabled={actionProcessing}
                  onClick={() => executeMarkActive(confirmAction.report)}
                  className="btn-primary text-xs px-5 py-2 font-bold"
                >
                  {actionProcessing ? "Activating Hazard..." : "Mark Active"}
                </button>
              )}

              {confirmAction.type === "delete_block" && (
                <button
                  disabled={actionProcessing}
                  onClick={() => executeDeleteRoadBlock(confirmAction.report)}
                  className="btn-secondary text-xs px-5 py-2 text-risk-veryhigh border-risk-veryhigh/40 hover:bg-risk-veryhigh/10 font-bold"
                >
                  {actionProcessing ? "Deleting..." : "Confirm Delete Road Block"}
                </button>
              )}

              {confirmAction.type === "reject" && (
                <button
                  disabled={actionProcessing}
                  onClick={() => executeReject(confirmAction.report)}
                  className="btn-secondary text-xs px-5 py-2 text-risk-veryhigh border-risk-veryhigh/40 hover:bg-risk-veryhigh/10 font-bold"
                >
                  {actionProcessing ? "Rejecting..." : "Reject Report"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FULL REPORT INSPECTION MODAL */}
      {viewReport && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
          <div className="panel max-w-2xl w-full p-6 space-y-5 bg-base-panel border border-base-border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <div>
                <p className="eyebrow">Hazard Report Inspection</p>
                <h2 className="text-xl font-bold capitalize text-ink">
                  {viewReport.ai_analysis?.hazard || viewReport.type.replace(/_/g, " ")}
                </h2>
              </div>
              <button
                onClick={() => setViewReport(null)}
                className="text-ink-muted hover:text-ink font-mono text-lg px-2 py-1"
              >
                ✕
              </button>
            </div>

            {viewReport.image_url && (
              <div className="space-y-1">
                <p className="text-xs font-mono text-ink-faint uppercase">📷 Uploaded Driver Image</p>
                <img
                  src={viewReport.image_url}
                  alt="Hazard"
                  onClick={() => setViewImage(viewReport.image_url)}
                  className="w-full max-h-80 object-cover rounded-lg border border-base-border cursor-pointer hover:opacity-95"
                />
              </div>
            )}

            {viewReport.voice_url && (
              <div className="p-4 rounded-lg border border-signal/30 bg-signal/5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-signal flex items-center gap-1.5">
                    <span>🎙</span> Driver Original Voice Recording
                  </span>
                  <span className="text-[10px] font-mono text-ink-muted">Audio Playback</span>
                </div>
                <audio src={viewReport.voice_url} controls className="w-full h-9" />
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-lg border border-base-border bg-base-raised text-xs">
              <div>
                <p className="text-ink-faint">Status</p>
                <p className="font-mono font-bold uppercase text-signal text-xs mt-0.5">
                  {viewReport.status.replace(/_/g, " ")}
                </p>
              </div>
              <div>
                <p className="text-ink-faint">Severity</p>
                <p className="font-mono font-bold uppercase text-risk-critical text-xs mt-0.5">
                  {viewReport.ai_analysis?.severity || viewReport.severity}
                </p>
              </div>
              <div>
                <p className="text-ink-faint">Confidence Score</p>
                <p className="font-mono font-semibold text-signal text-xs mt-0.5">
                  {viewReport.ai_analysis?.confidence != null
                    ? `${
                        viewReport.ai_analysis.confidence > 1
                          ? Math.round(viewReport.ai_analysis.confidence)
                          : Math.round(viewReport.ai_analysis.confidence * 100)
                      }%`
                    : "92%"}
                </p>
              </div>
              <div>
                <p className="text-ink-faint">Danger Radius</p>
                <p className="font-mono text-ink text-xs mt-0.5">{viewReport.radius_km || 5} km</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <p className="font-mono text-ink-faint uppercase mb-1">Driver & Submission Info</p>
                <div className="p-3 rounded border border-base-border bg-base-raised flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full overflow-hidden bg-base-border border border-base-border flex items-center justify-center shrink-0">
                      {viewReport.reporter?.photo_url ? (
                        <img src={viewReport.reporter.photo_url} alt={viewReport.reporter.full_name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-lg">👤</span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-ink">{viewReport.reporter?.full_name || "Driver"}</p>
                      <p className="text-ink-muted">{viewReport.reporter?.phone || "No phone listed"}</p>
                    </div>
                  </div>
                  <div className="text-right font-mono text-ink-faint">
                    <p>{new Date(viewReport.created_at).toLocaleDateString("en-IN")}</p>
                    <p>{new Date(viewReport.created_at).toLocaleTimeString("en-IN")}</p>
                  </div>
                </div>
              </div>

              {viewReport.ai_analysis?.explanation && (
                <div>
                  <p className="font-mono text-ink-faint uppercase mb-1">AI Model Analysis</p>
                  <p className="p-3 rounded border border-base-border bg-base-raised text-ink-muted leading-relaxed">
                    {viewReport.ai_analysis.explanation}
                  </p>
                </div>
              )}

              {viewReport.description && (
                <div>
                  <p className="font-mono text-ink-faint uppercase mb-1">Driver Text Description</p>
                  <p className="p-3 rounded border border-base-border bg-base-raised text-ink">{viewReport.description}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-base-border">
              <button onClick={() => setViewReport(null)} className="btn-secondary text-xs px-4 py-2">
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL IMAGE LIGHTBOX MODAL */}
      {viewImage && (
        <div
          onClick={() => setViewImage(null)}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img src={viewImage} alt="Enlarged Hazard" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
            <p className="text-xs font-mono text-white/80 mt-2">Click anywhere to close full-size image</p>
          </div>
        </div>
      )}

      {callTarget && (
        <CallDriverModal
          shipmentId={callTarget.id}
          driver={callTarget.driver}
          initiatedBy={user.id}
          reason="danger_zone_marked"
          detail={`${callTarget.source_name} → ${callTarget.destination_name}`}
          onClose={() => setCallTarget(null)}
        />
      )}
    </div>
  );
}
