import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  listOrgVehicles,
  listOrgDrivers,
  createShipment,
  insertRiskHistory,
  listActiveDangerZones,
  listAllProfiles,
} from "../../lib/dataService";
import { computeRoute, INDIA_LOCATIONS, searchLocations, isLocationInNer } from "../../lib/mapsService";
import { getRouteWeather, conditionLabel } from "../../lib/weatherService";
import { getHazardAlongPath } from "../../lib/hazardService";
import { scoreRouteOption, chooseBestRoute } from "../../lib/riskEngine";
import { filterRoutesAgainstDangerZones } from "../../lib/dangerZoneService";
import RouteMap from "../../components/maps/RouteMap";
import CallDriverModal from "../../components/shared/CallDriverModal";
import { supabase } from "../../lib/supabaseClient";

const GOODS_TYPES = [
  { value: "medicine", label: "Medicine", priority: "critical" },
  { value: "emergency_relief", label: "Emergency Relief", priority: "critical" },
  { value: "food", label: "Food Supplies", priority: "high" },
  { value: "construction_material", label: "Construction Material", priority: "normal" },
  { value: "general_cargo", label: "General Cargo", priority: "normal" },
  { value: "fuel", label: "Fuel", priority: "high" },
];

export default function CreateShipment() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);

  // Pan-India location search states
  const [sourceSearch, setSourceSearch] = useState("");
  const [destSearch, setDestSearch] = useState("");
  const [sourceOptions, setSourceOptions] = useState(INDIA_LOCATIONS);
  const [destOptions, setDestOptions] = useState(INDIA_LOCATIONS);

  const [selectedSource, setSelectedSource] = useState(INDIA_LOCATIONS[0]);
  const [selectedDest, setSelectedDest] = useState(INDIA_LOCATIONS[1]);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);

  const [form, setForm] = useState({
    goodsType: "medicine",
    priority: "critical",
    vehicleId: "",
    driverId: "",
  });

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showCallModal, setShowCallModal] = useState(false);

  // Manual Distance & Duration Typing Overrides
  const [manualDistance, setManualDistance] = useState("");
  const [manualDuration, setManualDuration] = useState("");

  useEffect(() => {
    async function loadFleet() {
      try {
        if (profile?.organization_id) {
          const v = await listOrgVehicles(profile.organization_id).catch(() => []);
          setVehicles((v || []).filter((x) => x.status === "available" || x.status === "assigned" || !x.status));
          const d = await listOrgDrivers(profile.organization_id).catch(() => []);
          setDrivers(d || []);
        } else {
          const { data: v } = await supabase.from("vehicles").select("*");
          setVehicles(v || []);
          const profiles = await listAllProfiles().catch(() => []);
          setDrivers((profiles || []).filter((p) => p.role === "secondary" || p.role === "primary"));
        }
      } catch (err) {
        console.warn("Failed to load vehicles/drivers:", err);
      }
    }
    loadFleet();
  }, [profile]);

  // Handle Pan-India location query changes
  useEffect(() => {
    let active = true;
    searchLocations(sourceSearch).then((results) => {
      if (active) setSourceOptions(results);
    });
    return () => { active = false; };
  }, [sourceSearch]);

  useEffect(() => {
    let active = true;
    searchLocations(destSearch).then((results) => {
      if (active) setDestOptions(results);
    });
    return () => { active = false; };
  }, [destSearch]);

  const handleSelectSource = (loc) => {
    if (!loc) return;
    setSelectedSource(loc);
    setSourceSearch(loc.name);
    setShowSourceDropdown(false);
    setPreview(null);
  };

  const handleSelectDest = (loc) => {
    if (!loc) return;
    setSelectedDest(loc);
    setDestSearch(loc.name);
    setShowDestDropdown(false);
    setPreview(null);
  };

  const source = selectedSource || INDIA_LOCATIONS[0];
  const destination = selectedDest || INDIA_LOCATIONS[1];
  const isNerRoute = isLocationInNer(source.lat, source.lng) || isLocationInNer(destination.lat, destination.lng);

  const handleGoodsType = (e) => {
    const gt = GOODS_TYPES.find((g) => g.value === e.target.value);
    setForm((f) => ({ ...f, goodsType: gt.value, priority: gt.priority }));
  };

  const generateRoute = async () => {
    if (source.name === destination.name) {
      setError("Source and destination must be different.");
      return;
    }
    setError("");
    setPreviewLoading(true);
    try {
      // 1. Real Pan-India route(s) from OSRM — recommended + alternate.
      const route = await computeRoute({ origin: source, destination });

      // 2. Live weather (Open-Meteo) sampled along each candidate route.
      const [recWeather, altWeather] = await Promise.all([
        getRouteWeather({ path: route.recommended.overviewPath }),
        route.alternate ? getRouteWeather({ path: route.alternate.overviewPath }) : Promise.resolve(null),
      ]);

      // 3. Historical GIS hazard exposure along route.
      const recHazard = getHazardAlongPath(route.recommended.overviewPath);
      const altHazard = route.alternate ? getHazardAlongPath(route.alternate.overviewPath) : null;

      // 4. Merge weather + hazard + priority into AI/ML + Risk Score per route.
      const recScored = await scoreRouteOption({
        route: route.recommended,
        routeWeather: recWeather,
        hazardSummary: recHazard,
        priority: form.priority,
      });

      const altScored = route.alternate
        ? await scoreRouteOption({
            route: route.alternate,
            routeWeather: altWeather,
            hazardSummary: altHazard,
            priority: form.priority,
          })
        : null;

      // 5. Risk-vs-time route comparison.
      const comparison = altScored
        ? chooseBestRoute([
            { key: "recommended", ...recScored },
            { key: "alternate", ...altScored },
          ])
        : null;

      // 6. Admin-marked danger zones override: filter routes crossing active danger zones.
      const dangerZones = await listActiveDangerZones().catch(() => []);
      const filtered = filterRoutesAgainstDangerZones(
        { recommended: route.recommended, alternate: route.alternate },
        dangerZones
      );

      let useAlternate = comparison?.best === "alternate";
      let dangerZoneNotice = null;

      if (filtered.recommended.blocked && !filtered.alternate?.blocked && route.alternate) {
        useAlternate = true;
        dangerZoneNotice = `Recommended route blocked by active danger zone (${filtered.recommended.zones
          .map((z) => z.description || z.type)
          .join(", ")}). Alternate route activated.`;
      } else if (filtered.alternate?.blocked && !filtered.recommended.blocked) {
        useAlternate = false;
        dangerZoneNotice = `Alternate route blocked by active danger zone (${filtered.alternate.zones
          .map((z) => z.description || z.type)
          .join(", ")}). Recommended route activated.`;
      } else if (filtered.recommended.blocked && filtered.alternate?.blocked) {
        dangerZoneNotice = "Both candidate routes cross active danger zones. No safe path currently available — notify dispatch admin.";
      }

      setPreview({
        route,
        recScored,
        altScored,
        comparison,
        useAlternate,
        dangerZoneNotice,
        bothRoutesBlocked: filtered.recommended.blocked && !!filtered.alternate?.blocked,
        routeChangedByDangerZone: !!dangerZoneNotice && !(filtered.recommended.blocked && filtered.alternate?.blocked),
      });

      const initialRoute = useAlternate ? route.alternate : route.recommended;
      setManualDistance(initialRoute.distanceKm.toFixed(1));
      setManualDuration(Math.round(initialRoute.durationMin).toString());
    } catch (err) {
      setError(err.message || "Failed to generate route.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleRouteChoice = () => {
    setPreview((p) => (p ? { ...p, useAlternate: !p.useAlternate } : p));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!preview) {
      setError("Generate the route first.");
      return;
    }
    if (!form.vehicleId || !form.driverId) {
      setError("Select a vehicle and a driver.");
      return;
    }
    if (preview.bothRoutesBlocked) {
      setError("Both routes cross an active danger zone. Cannot dispatch until cleared.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const activeRoute = preview.useAlternate ? preview.route.alternate : preview.route.recommended;
      const otherRoute = preview.useAlternate ? preview.route.recommended : preview.route.alternate;
      const activeRisk = preview.useAlternate ? preview.altScored?.risk : preview.recScored.risk;

      const finalDistanceKm = manualDistance && !isNaN(Number(manualDistance)) && Number(manualDistance) > 0
        ? Number(manualDistance)
        : activeRoute.distanceKm;

      const finalDurationMin = manualDuration && !isNaN(Number(manualDuration)) && Number(manualDuration) > 0
        ? Number(manualDuration)
        : activeRoute.durationMin;

      const now = new Date();
      const etaOriginal = new Date(now.getTime() + finalDurationMin * 60000);

      const shipment = await createShipment({
        organization_id: profile?.organization_id || "00000000-0000-0000-0000-000000000000",
        created_by: profile?.id,
        driver_id: form.driverId,
        vehicle_id: form.vehicleId,
        source_name: source.name,
        source_lat: source.lat,
        source_lng: source.lng,
        destination_name: destination.name,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        goods_type: form.goodsType,
        priority: form.priority,
        status: "assigned",
        route_json: { ...activeRoute, distanceKm: finalDistanceKm, durationMin: finalDurationMin },
        alternate_route_json: otherRoute,
        distance_km: finalDistanceKm,
        risk_score: activeRisk.score,
        risk_level: activeRisk.level,
        risk_explanation: activeRisk.explanation,
        eta_original: etaOriginal.toISOString(),
        eta_current: etaOriginal.toISOString(),
      });

      await insertRiskHistory({
        shipmentId: shipment.id,
        score: activeRisk.score,
        factors: activeRisk.factors,
        explanation: activeRisk.explanation,
      });

      navigate(`/primary/shipments/${shipment.id}`);
    } catch (err) {
      setError(err.message || "Failed to create shipment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="eyebrow mb-1">Pan-India Logistics Engine</p>
        <h1 className="text-2xl font-semibold">Create Pan-India Shipment</h1>
        <p className="text-xs text-ink-muted">Route shipments anywhere across India with enhanced NER hazard intelligence.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-5 space-y-4">
          {/* Pan-India Origin Picker with Floating Autocomplete Overlay */}
          <div className="space-y-1 relative">
            <label className="label text-xs font-semibold flex items-center justify-between">
              <span>Origin (Source Location in India)</span>
              <span className="text-[10px] text-signal font-mono">Selected: {source.name}</span>
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Type any City, Town, or District in India..."
                value={sourceSearch}
                onFocus={() => setShowSourceDropdown(true)}
                onChange={(e) => {
                  setSourceSearch(e.target.value);
                  setShowSourceDropdown(true);
                }}
                className="input text-xs w-full pr-8 border-signal/40 focus:border-signal"
              />
              {sourceSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setSourceSearch("");
                    setShowSourceDropdown(true);
                  }}
                  className="absolute right-2 top-2 text-xs text-ink-faint hover:text-ink font-bold"
                >
                  ✕
                </button>
              )}

              {/* Floating Autocomplete Dropdown */}
              {showSourceDropdown && sourceOptions && sourceOptions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-base-panel border border-signal/50 rounded-lg shadow-2xl z-50 max-h-60 overflow-y-auto divide-y divide-base-border">
                  <div className="px-3 py-1.5 bg-base-raised text-[10px] text-ink-faint uppercase font-mono font-bold flex justify-between items-center">
                    <span>Click to Select Origin:</span>
                    <button type="button" onClick={() => setShowSourceDropdown(false)} className="hover:text-ink">Close ✕</button>
                  </div>
                  {sourceOptions.map((loc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSource(loc)}
                      className="w-full p-2.5 text-left hover:bg-signal/15 transition-colors flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-xs text-ink font-semibold flex items-center gap-1.5">
                          <span>📍</span>
                          <span>{loc.name}</span>
                        </p>
                        {loc.district && (
                          <p className="text-[10px] text-ink-faint font-mono mt-0.5">
                            Dist: {loc.district} {loc.subdistrict ? `· Sub-dist: ${loc.subdistrict}` : ""}
                          </p>
                        )}
                      </div>
                      {loc.isNer && <span className="text-[10px] text-signal font-mono shrink-0">🏔 NER</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pan-India Destination Picker with Floating Autocomplete Overlay */}
          <div className="space-y-1 relative">
            <label className="label text-xs font-semibold flex items-center justify-between">
              <span>Destination (Endpoint anywhere in India)</span>
              <span className="text-[10px] text-signal font-mono">Selected: {destination.name}</span>
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Type any Destination City, Town, or District in India..."
                value={destSearch}
                onFocus={() => setShowDestDropdown(true)}
                onChange={(e) => {
                  setDestSearch(e.target.value);
                  setShowDestDropdown(true);
                }}
                className="input text-xs w-full pr-8 border-signal/40 focus:border-signal"
              />
              {destSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setDestSearch("");
                    setShowDestDropdown(true);
                  }}
                  className="absolute right-2 top-2 text-xs text-ink-faint hover:text-ink font-bold"
                >
                  ✕
                </button>
              )}

              {/* Floating Autocomplete Dropdown */}
              {showDestDropdown && destOptions && destOptions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-base-panel border border-signal/50 rounded-lg shadow-2xl z-50 max-h-60 overflow-y-auto divide-y divide-base-border">
                  <div className="px-3 py-1.5 bg-base-raised text-[10px] text-ink-faint uppercase font-mono font-bold flex justify-between items-center">
                    <span>Click to Select Destination:</span>
                    <button type="button" onClick={() => setShowDestDropdown(false)} className="hover:text-ink">Close ✕</button>
                  </div>
                  {destOptions.map((loc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectDest(loc)}
                      className="w-full p-2.5 text-left hover:bg-signal/15 transition-colors flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-xs text-ink font-semibold flex items-center gap-1.5">
                          <span>🎯</span>
                          <span>{loc.name}</span>
                        </p>
                        {loc.district && (
                          <p className="text-[10px] text-ink-faint font-mono mt-0.5">
                            Dist: {loc.district} {loc.subdistrict ? `· Sub-dist: ${loc.subdistrict}` : ""}
                          </p>
                        )}
                      </div>
                      {loc.isNer && <span className="text-[10px] text-signal font-mono shrink-0">🏔 NER</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isNerRoute && (
            <div className="p-2.5 rounded-lg border border-signal/40 bg-signal/5 text-xs text-signal font-mono flex items-center gap-2">
              <span>🏔</span>
              <span>Enhanced NER Logistics & Hazard Intelligence Active</span>
            </div>
          )}

          <div>
            <label className="label">Goods Type</label>
            <select className="input" value={form.goodsType} onChange={handleGoodsType}>
              {GOODS_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Vehicle</label>
              <select className="input" value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
                <option value="">Select vehicle…</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_no} ({v.vehicle_type})</option>)}
              </select>
              {vehicles.length === 0 && <p className="text-xs text-risk-moderate mt-1">No available vehicles — add one under Fleet.</p>}
            </div>
            <div>
              <label className="label">Driver</label>
              <select className="input" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}>
                <option value="">Select driver…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
              {drivers.length === 0 && <p className="text-xs text-risk-moderate mt-1">No drivers — invite one via signup link.</p>}
            </div>
          </div>

          <button type="button" onClick={generateRoute} disabled={previewLoading} className="btn-secondary w-full">
            {previewLoading ? "Generating Pan-India OSRM Route…" : "Generate Route & Risk Analysis"}
          </button>

          {error && <p className="text-xs text-risk-veryhigh">{error}</p>}

          <button type="submit" disabled={submitting || !preview} className="btn-primary w-full">
            {submitting ? "Creating…" : "Create & Dispatch Shipment"}
          </button>
        </div>

        <div className="space-y-4">
          <div className="panel p-3">
            <RouteMap
              source={source}
              destination={destination}
              recommendedPath={
                preview
                  ? (preview.useAlternate ? preview.route.alternate : preview.route.recommended).overviewPath
                  : undefined
              }
              alternatePath={
                preview
                  ? (preview.useAlternate ? preview.route.recommended : preview.route.alternate)?.overviewPath
                  : undefined
              }
              height={280}
            />
          </div>

          {preview && (() => {
            const activeRoute = preview.useAlternate ? preview.route.alternate : preview.route.recommended;
            const activeScored = preview.useAlternate ? preview.altScored : preview.recScored;
            const otherScored = preview.useAlternate ? preview.recScored : preview.altScored;

            return (
              <>
                <div className="panel p-5 space-y-3">
                  {activeScored?.mlEvaluation && (
                    <div className="bg-base-raised p-3 rounded-lg border border-base-border space-y-1.5 text-xs mb-1">
                      <p className="font-mono text-signal uppercase tracking-wider text-[10px]">AI/ML Engine Evaluation</p>
                      <div className="flex justify-between"><span className="text-ink-muted">Disruption Probability</span><span className="font-mono text-ink">{Math.round(activeScored.mlEvaluation.disruption_probability * 100)}%</span></div>
                      <div className="flex justify-between"><span className="text-ink-muted">Predicted Delay</span><span className="font-mono text-ink">{activeScored.mlEvaluation.predicted_delay_minutes} min</span></div>
                      <div className="flex justify-between"><span className="text-ink-muted">Hazard Severity</span><span className="font-mono text-ink">{activeScored.mlEvaluation.hazard_severity}</span></div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Active Route Distance</span>
                    <span className="data-mono font-bold text-signal">
                      {manualDistance || activeRoute.distanceKm.toFixed(1)} km
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Estimated Duration</span>
                    <span className="data-mono font-bold text-ink">
                      {((manualDuration ? Number(manualDuration) : activeRoute.durationMin) / 60).toFixed(1)} h
                    </span>
                  </div>

                  {/* ROUTE DISTANCE CUSTOMIZER & SHORTEST PATH SELECTOR (Manual Typing Enabled) */}
                  <div className="p-3.5 rounded-xl border border-signal/40 bg-signal/5 space-y-3 my-2">
                    <div className="flex items-center justify-between">
                      <p className="eyebrow text-signal font-bold">📏 Manual Distance Override & Shortest Path</p>
                      <span className="text-[10px] font-mono text-ink-faint">Manual Typing Enabled</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-ink-muted mb-1">
                          Manual Distance (km)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={manualDistance}
                          onChange={(e) => setManualDistance(e.target.value)}
                          placeholder="Type lower distance..."
                          className="w-full bg-base-raised border border-base-border rounded px-2.5 py-1.5 text-xs text-ink font-mono focus:outline-none focus:border-signal"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-ink-muted mb-1">
                          Manual Duration (mins)
                        </label>
                        <input
                          type="number"
                          value={manualDuration}
                          onChange={(e) => setManualDuration(e.target.value)}
                          placeholder="Type minutes..."
                          className="w-full bg-base-raised border border-base-border rounded px-2.5 py-1.5 text-xs text-ink font-mono focus:outline-none focus:border-signal"
                        />
                      </div>
                    </div>

                    {preview.route.alternate && (
                      <button
                        type="button"
                        onClick={() => {
                          const minKm = Math.min(preview.route.recommended.distanceKm, preview.route.alternate.distanceKm);
                          setManualDistance(minKm.toFixed(1));
                          if (preview.route.alternate.distanceKm < preview.route.recommended.distanceKm && !preview.useAlternate) {
                            toggleRouteChoice();
                          }
                        }}
                        className="btn-secondary w-full text-xs py-1.5 font-mono text-signal border-signal/40 bg-signal/15 hover:bg-signal/30 font-bold"
                      >
                        ⚡ Select Lowest Distance Route ({Math.min(preview.route.recommended.distanceKm, preview.route.alternate.distanceKm).toFixed(1)} km)
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Route Coverage</span>
                    <span className="data-mono uppercase font-bold text-signal">
                      {isNerRoute ? "North Eastern Region (Enhanced AI)" : "Pan-India Route"}
                    </span>
                  </div>
                  {activeScored?.routeWeather?.worst && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-muted">Corridor weather</span>
                      <span className="data-mono">
                        {conditionLabel(activeScored.routeWeather.worst.condition)}
                        {activeScored.routeWeather.worst.rainfall_mm > 0
                          ? ` · ${activeScored.routeWeather.worst.rainfall_mm.toFixed(1)}mm/h`
                          : ""}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-base-border">
                    <p className="text-xs text-ink-faint mb-1">Mathematical Risk Score ({activeScored?.risk?.score}/100)</p>
                    <p className="text-sm text-ink">{activeScored?.risk?.explanation}</p>
                  </div>
                </div>

                {otherScored && preview.comparison && (
                  <div className="panel p-4 space-y-2 border-signal/30 bg-signal/5">
                    <p className="eyebrow">Best-route recommendation</p>
                    <p className="text-sm text-ink">{preview.comparison.explanation}</p>
                    {preview.comparison.best !== (preview.useAlternate ? "alternate" : "recommended") && (
                      <button type="button" onClick={toggleRouteChoice} className="btn-secondary mt-1">
                        Switch to {preview.comparison.best === "alternate" ? "alternate" : "recommended"} route
                      </button>
                    )}
                    {preview.comparison.best === (preview.useAlternate ? "alternate" : "recommended") && (
                      <button type="button" onClick={toggleRouteChoice} className="text-xs text-ink-faint underline">
                        View the other route instead
                      </button>
                    )}
                  </div>
                )}

                {preview.dangerZoneNotice && (
                  <div className={`panel p-4 space-y-2 ${preview.bothRoutesBlocked ? "border-risk-critical/50 bg-risk-critical/10" : "border-risk-high/40 bg-risk-high/5"}`}>
                    <p className="eyebrow">⚠ Admin-marked danger zone</p>
                    <p className="text-sm text-ink">{preview.dangerZoneNotice}</p>
                    {preview.routeChangedByDangerZone && form.driverId && (
                      <button type="button" onClick={() => setShowCallModal(true)} className="btn-secondary mt-1">
                        📞 Call driver — notify of route change
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </form>

      {showCallModal && (
        <CallDriverModal
          shipmentId={null}
          driver={drivers.find((d) => d.id === form.driverId)}
          initiatedBy={profile?.id}
          reason="route_changed"
          detail={`${source?.name} → ${destination?.name}`}
          onClose={() => setShowCallModal(false)}
        />
      )}
    </div>
  );
}
