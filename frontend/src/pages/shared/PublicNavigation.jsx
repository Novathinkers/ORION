import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useGeolocation } from "../../hooks/useGeolocation";
import { computeRoute, searchLocations, INDIA_LOCATIONS, formatEta, formatDuration, fetchIpLocation } from "../../lib/mapsService";
import { computeEta, VEHICLE_SPEED_PROFILES } from "../../lib/riskEngine";
import { reportHazard, getActiveIncidents, getLatestWeather, getActiveRoadIssues, listAllShipments, listDriverShipments, saveNavigationUser } from "../../lib/dataService";
import { uploadHazardImage } from "../../lib/imageAnalysisService";
import RouteMap from "../../components/maps/RouteMap";
import ReportHazardModal from "../../components/shared/ReportHazardModal";

import { Link } from "react-router-dom";
import ThemeToggle from "../../components/shared/ThemeToggle";
import LanguageSwitcher from "../../components/shared/LanguageSwitcher";

const VEHICLE_MODES = [
  { id: "car", label: "Car", speedKmh: 75, icon: "🚗" },
  { id: "bike", label: "Bike / Two-Wheeler", speedKmh: 50, icon: "🏍" },
  { id: "van", label: "Delivery Van", speedKmh: 65, icon: "🚐" },
  { id: "truck", label: "Standard Truck", speedKmh: 55, icon: "🚚" },
  { id: "heavy_truck", label: "Heavy Truck", speedKmh: 45, icon: "🚛" },
  { id: "walking", label: "Walking", speedKmh: 5, icon: "🚶" },
];

const HAZARD_TYPES = [
  { value: "accident", label: "Accident / Collision" },
  { value: "roadblock", label: "Roadblock / Construction" },
  { value: "landslide", label: "Landslide / Flood" },
  { value: "weather", label: "Bad Weather / Fog" },
  { value: "pothole", label: "Damaged Road / Pothole" },
  { value: "wildlife", label: "Animals on Road" },
  { value: "unclear", label: "Other Hazard" },
];

export default function PublicNavigation() {
  const { user, profile } = useAuth();
  const geo = useGeolocation();
  const [ipLocation, setIpLocation] = useState(null);
  const [driverDestinations, setDriverDestinations] = useState([]);

  // Guest info detection (Name & Phone Number)
  const searchParams = new URLSearchParams(window.location.search);
  const urlGuestName = searchParams.get("name");
  const urlGuestPhone = searchParams.get("phone");
  const storedGuestName = localStorage.getItem("orion_public_guest_name");
  const storedGuestPhone = localStorage.getItem("orion_public_guest_phone");

  const defaultName = profile?.full_name || urlGuestName || storedGuestName || (user?.email ? user.email.split("@")[0] : "");
  const defaultPhone = profile?.phone || urlGuestPhone || storedGuestPhone || "";

  const [guestName, setGuestName] = useState(defaultName);
  const [guestPhone, setGuestPhone] = useState(defaultPhone);
  const [showGuestInfoModal, setShowGuestInfoModal] = useState(false);

  useEffect(() => {
    if (defaultName && !guestName) setGuestName(defaultName);
    if (defaultPhone && !guestPhone) setGuestPhone(defaultPhone);
  }, [defaultName, defaultPhone]);

  const displayName = profile?.full_name || guestName || "Traveler";
  const displayPhone = profile?.phone || guestPhone || "";

  const [inputName, setInputName] = useState(displayName);
  const [inputPhone, setInputPhone] = useState(displayPhone);

  const handleSaveGuestInfo = async (e) => {
    e.preventDefault();
    const finalName = inputName.trim() || "Public Traveler";
    const finalPhone = inputPhone.trim() || "";
    setGuestName(finalName);
    setGuestPhone(finalPhone);
    localStorage.setItem("orion_public_guest_name", finalName);
    localStorage.setItem("orion_public_guest_phone", finalPhone);
    // Persist navigation user to SQL Database table
    await saveNavigationUser({
      name: finalName,
      phone: finalPhone,
      lat: geo.position?.lat || ipLocation?.lat || null,
      lng: geo.position?.lng || ipLocation?.lng || null,
    }).catch(() => {});
    setShowGuestInfoModal(false);
  };

  // Navigation search & routing states
  const [sourceSearch, setSourceSearch] = useState("");
  const [destSearch, setDestSearch] = useState("");
  const [sourceOptions, setSourceOptions] = useState(INDIA_LOCATIONS);
  const [destOptions, setDestOptions] = useState(INDIA_LOCATIONS);

  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(INDIA_LOCATIONS[1]); // Default Shillong endpoint
  const [useCurrentGps, setUseCurrentGps] = useState(true);

  // Auto-detect IP location fallback if GPS is pending or blocked
  useEffect(() => {
    fetchIpLocation().then((loc) => {
      if (loc) setIpLocation(loc);
    });
  }, []);

  // Load Active Driver Shipment Destinations from DB
  useEffect(() => {
    async function loadDriverDestinations() {
      try {
        let shipments = [];
        if (user?.id) {
          shipments = await listDriverShipments(user.id).catch(() => []);
        }
        if (!shipments || shipments.length === 0) {
          shipments = await listAllShipments().catch(() => []);
        }

        if (shipments && shipments.length > 0) {
          const formatted = shipments.map((s) => ({
            name: `🎯 ${s.destination_name} (Driver Route: ${s.source_name} → ${s.destination_name})`,
            shortName: s.destination_name,
            lat: s.destination_lat,
            lng: s.destination_lng,
            isDriverDestination: true,
            shipment: s,
          }));
          setDriverDestinations(formatted);
          // Set options list with driver destinations at top
          setDestOptions([...formatted, ...INDIA_LOCATIONS]);
          // Auto-select driver shipment destination
          setSelectedDest(formatted[0]);
        }
      } catch (err) {
        console.warn("Failed to load driver shipment destinations:", err);
      }
    }
    loadDriverDestinations();
  }, [user]);

  const [selectedVehicle, setSelectedVehicle] = useState(VEHICLE_MODES[0]); // Default: Car
  const [routeResult, setRouteResult] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");

  const [incidents, setIncidents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [roadIssues, setRoadIssues] = useState([]);

  // Hazard reporting modal states
  const [showHazardModal, setShowHazardModal] = useState(false);
  const [hazardType, setHazardType] = useState("accident");
  const [hazardSeverity, setHazardSeverity] = useState("high");
  const [hazardDesc, setHazardDesc] = useState("");
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  const lastCalculatedKeyRef = useRef("");

  // Effective origin point (GPS -> IP Location -> Selected Source -> Default)
  const getEffectiveOrigin = useCallback(() => {
    if (useCurrentGps) {
      if (geo.position) {
        return { name: "📍 My Current Location (GPS)", lat: geo.position.lat, lng: geo.position.lng };
      }
      if (ipLocation) {
        return ipLocation;
      }
    }
    return selectedSource || INDIA_LOCATIONS[0];
  }, [useCurrentGps, geo.position, ipLocation, selectedSource]);

  const currentOrigin = getEffectiveOrigin();

  // Route calculation using exact current GPS / IP position
  const handleCalculateRoute = useCallback(async (force = false) => {
    const originToUse = getEffectiveOrigin();

    if (!originToUse) return;

    let targetDest = selectedDest || INDIA_LOCATIONS[1];

    if (Math.abs(originToUse.lat - targetDest.lat) < 0.0001 && Math.abs(originToUse.lng - targetDest.lng) < 0.0001) {
      targetDest = INDIA_LOCATIONS[1].name !== targetDest.name ? INDIA_LOCATIONS[1] : INDIA_LOCATIONS[2];
    }

    const routeKey = `${originToUse.lat.toFixed(4)},${originToUse.lng.toFixed(4)}->${targetDest.lat.toFixed(4)},${targetDest.lng.toFixed(4)}`;
    if (!force && lastCalculatedKeyRef.current === routeKey) {
      return; // Already calculated for these exact coordinates, prevent re-render loop
    }

    lastCalculatedKeyRef.current = routeKey;
    setRouteError("");
    setRouteLoading(true);
    try {
      const routeData = await computeRoute({ origin: originToUse, destination: targetDest });
      setRouteResult(routeData);
    } catch (err) {
      setRouteError(err.message || "Failed to calculate navigation route.");
    } finally {
      setRouteLoading(false);
    }
  }, [getEffectiveOrigin, selectedDest]);

  const handleSelectDestination = (loc) => {
    if (!loc) return;
    setSelectedDest(loc);
    setDestSearch(loc.name || loc.fullName || "");
    setShowDestDropdown(false);
  };

  const handleSearchSubmit = (e) => {
    e?.preventDefault();
    if (selectedDest) {
      handleCalculateRoute(true);
    } else if (destOptions && destOptions.length > 0) {
      handleSelectDestination(destOptions[0]);
    }
  };

  const handleSelectSource = (loc) => {
    if (!loc) return;
    setSelectedSource(loc);
    setSourceSearch(loc.name || loc.fullName || "");
    setShowSourceDropdown(false);
  };

  // Start GPS tracking on mount
  useEffect(() => {
    geo.requestOnce().catch(() => {});
    geo.start();
    return () => geo.stop();
  }, []); // eslint-disable-line

  // Load environmental hazards & weather
  const loadIncidentsAndEnvironment = useCallback(async () => {
    try {
      const [inc, w, r] = await Promise.all([
        getActiveIncidents().catch(() => []),
        getLatestWeather().catch(() => []),
        getActiveRoadIssues().catch(() => []),
      ]);
      setIncidents(inc || []);
      setWeather(w?.[0] || null);
      setRoadIssues(r || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadIncidentsAndEnvironment();
  }, [loadIncidentsAndEnvironment]);

  // Location search handlers
  useEffect(() => {
    let active = true;
    searchLocations(sourceSearch).then((res) => {
      if (active) setSourceOptions(res);
    });
    return () => { active = false; };
  }, [sourceSearch]);

  useEffect(() => {
    let active = true;
    searchLocations(destSearch).then((res) => {
      if (active) setDestOptions(res);
    });
    return () => { active = false; };
  }, [destSearch]);

  // Force re-fetch GPS position and update route
  const handleSyncGps = async () => {
    try {
      setUseCurrentGps(true);
      await geo.requestOnce();
      geo.start();
    } catch (err) {
      setRouteError("GPS Note: " + (err.message || "Permission denied") + " — Using IP Location fallback.");
    }
  };

  // Re-calculate route whenever GPS position arrives/updates, IP location loads, or destination changes
  useEffect(() => {
    handleCalculateRoute();
  }, [selectedDest, useCurrentGps, geo.position?.lat, geo.position?.lng, ipLocation?.lat, ipLocation?.lng]); // eslint-disable-line

  // Compute travel duration based on selected vehicle
  const activeRoute = routeResult?.recommended;
  const etaCalculation = activeRoute
    ? computeEta({
        remainingKm: activeRoute.distanceKm,
        baseSpeedKmh: selectedVehicle.speedKmh,
        weather,
        roadStatus: roadIssues[0]?.status || null,
      })
    : null;

  const etaArrivalTime = etaCalculation
    ? new Date(Date.now() + etaCalculation.minutes * 60000)
    : null;

  // Generate Turn-by-Turn Guidance steps from Start to End
  const turnSteps = activeRoute
    ? [
        {
          id: 1,
          icon: "🟢",
          maneuver: "Depart Origin",
          title: `Start navigation from ${currentOrigin?.name || "Current Location"}`,
          detail: `Head towards ${selectedDest?.name}`,
          distKm: 0,
        },
        {
          id: 2,
          icon: "⬆️",
          maneuver: "Continue Straight",
          title: `Merge onto Primary Highway Corridor towards ${selectedDest?.district || selectedDest?.name}`,
          detail: `Maintain recommended speed at ${selectedVehicle.speedKmh} km/h`,
          distKm: Math.max(0.5, (activeRoute.distanceKm * 0.12).toFixed(1)),
        },
        ...(incidents && incidents.length > 0
          ? incidents.slice(0, 2).map((inc, i) => ({
              id: 3 + i,
              icon: "⚠️",
              maneuver: "Hazard Caution",
              title: `Caution: ${inc.type?.toUpperCase() || "HAZARD"} reported near route`,
              detail: inc.description || "Drive carefully and maintain extra braking gap.",
              distKm: (activeRoute.distanceKm * (0.35 + i * 0.25)).toFixed(1),
              isDanger: true,
            }))
          : []),
        ...(activeRoute.distanceKm > 25
          ? [
              {
                id: 10,
                icon: "🏛",
                maneuver: "Regional Crossing",
                title: `Cross District / Regional Boundary checkpoint`,
                detail: `Continue on primary route towards ${selectedDest?.name}`,
                distKm: (activeRoute.distanceKm * 0.65).toFixed(1),
              },
            ]
          : []),
        {
          id: 98,
          icon: "↘️",
          maneuver: "Approaching Destination",
          title: `Prepare to arrive at ${selectedDest?.name}`,
          detail: `Destination is ${selectedDest?.district ? `in District ${selectedDest.district}` : "ahead"}`,
          distKm: (activeRoute.distanceKm * 0.95).toFixed(1),
        },
        {
          id: 99,
          icon: "🏁",
          maneuver: "Arrive at Destination",
          title: `Arrive at Destination: ${selectedDest?.name}`,
          detail: `Total Journey: ${activeRoute.distanceKm.toFixed(1)} km · Est. Duration: ${formatDuration(etaCalculation?.minutes || 0)}`,
          distKm: activeRoute.distanceKm,
        },
      ]
    : [];

  const activeTurnStep = turnSteps[currentStepIdx] || turnSteps[0];



  return (
    <div className="space-y-6">
      {/* Standalone Public Header (When accessed without login) */}
      {!user && (
        <div className="bg-base-panel border border-base-border p-4 rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/login" className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="font-display font-semibold tracking-tight text-base text-ink">ORION NAVIGATION</span>
            </Link>
            <span className="px-2.5 py-1 rounded-full bg-signal/15 border border-signal/30 text-signal text-xs font-bold flex items-center gap-1.5 cursor-pointer" onClick={() => setShowGuestInfoModal(true)}>
              <span>👤</span>
              <span>Welcome, {displayName}{displayPhone ? ` (📞 ${displayPhone})` : ""}</span>
              <span className="text-[10px] text-ink-muted underline ml-1">Edit ✏️</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <LanguageSwitcher />
            <Link to="/login" className="btn-secondary text-xs py-1.5 px-3">
              🔑 Sign in / Account
            </Link>
          </div>
        </div>
      )}

      {/* Header & App Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="live-dot" />
            <p className="eyebrow">Google Maps Style Live Navigation</p>
          </div>
          <h1 className="text-2xl font-semibold">Live GPS Navigation & Hazard Reporter</h1>
          <p className="text-xs text-ink-muted">
            {user ? `Active User: ${displayName}` : `Guest User: ${displayName}${displayPhone ? ` (Phone: ${displayPhone})` : ""}`} · Turn-by-turn routing from current GPS position with real-time hazard alerts & vehicle speed profiles.
          </p>
        </div>

        <button
          onClick={() => setShowHazardModal(true)}
          className="btn-primary flex items-center gap-2 bg-risk-veryhigh/90 hover:bg-risk-veryhigh text-white font-bold py-2.5 px-4 rounded-lg shadow-lg text-xs tracking-wide uppercase"
        >
          <span className="text-base">⚠️</span>
          <span>Report Road Hazard</span>
        </button>
      </div>

      {/* Main Grid: Control Panel & Live Map */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Route Setup & Controls */}
        <div className="space-y-4">
          <div className="panel p-4 space-y-4">
            

            {/* GPS Toggle vs Custom Origin */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCurrentGps}
                    onChange={(e) => {
                      setUseCurrentGps(e.target.checked);
                      if (e.target.checked) handleSyncGps();
                    }}
                    className="rounded border-base-border text-signal focus:ring-signal"
                  />
                  <span>Use Current Location</span>
                </label>

                <button
                  type="button"
                  onClick={handleSyncGps}
                  className="text-[10px] text-signal hover:underline font-mono font-bold flex items-center gap-1"
                >
                  <span>🔄 RELOCATE</span>
                </button>
              </div>

              {useCurrentGps ? (
                <div className="p-3 bg-base-raised rounded-lg border border-base-border text-xs font-mono space-y-2">
                  {geo.loadingGps ? (
                    <div className="flex items-center gap-2 text-signal">
                      <span className="h-2 w-2 rounded-full bg-signal animate-ping" />
                      <span>Acquiring live GPS satellites & network location…</span>
                    </div>
                  ) : geo.position ? (
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-signal font-bold flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-signal animate-pulse" />
                          <span>📍 Live GPS Location</span>
                        </p>
                        {geo.position.accuracyM && (
                          <span className="text-[10px] text-ink-faint">±{Math.round(geo.position.accuracyM)}m</span>
                        )}
                      </div>
                      <p className="text-ink mt-0.5">{geo.position.lat.toFixed(5)}°N, {geo.position.lng.toFixed(5)}°E</p>
                    </div>
                  ) : ipLocation ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-signal font-bold flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-signal" />
                          <span>🌐 Auto IP Location (Fallback):</span>
                        </p>
                        <span className="text-[10px] text-ink-faint">IP Geo</span>
                      </div>
                      <p className="text-ink font-semibold">{ipLocation.name}</p>
                      <p className="text-ink-faint text-[10px]">{ipLocation.lat.toFixed(4)}°N, {ipLocation.lng.toFixed(4)}°E</p>
                      <button
                        type="button"
                        onClick={handleSyncGps}
                        className="btn-secondary text-[10px] py-1 px-2 w-full text-signal border-signal/40 mt-1"
                      >
                        📍 Allow & Sync High-Accuracy GPS
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-risk-moderate font-bold">⚠ GPS Permission Blocked or Pending</p>
                      <p className="text-ink-faint text-[10px] leading-relaxed">
                        To enable precise GPS: Click the 🔒 lock icon next to your browser address bar → Set Location to "Allow" → Tap Retry.
                      </p>
                      <button
                        type="button"
                        onClick={handleSyncGps}
                        className="btn-primary text-[11px] py-1.5 px-2 w-full font-bold"
                      >
                        📍 Tap to Request / Retry GPS Access
                      </button>
                    </div>
                  )}

                </div>
              ) : (
                <div className="space-y-1">
                  <label className="label text-xs">Origin (Start Point)</label>
                  <input
                    type="text"
                    placeholder="Search start location..."
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    className="input text-xs mb-1"
                  />
                  <select
                    className="input text-xs font-mono"
                    onChange={(e) => setSelectedSource(sourceOptions[Number(e.target.value)])}
                  >
                    {sourceOptions.map((loc, idx) => (
                      <option key={idx} value={idx}>{loc.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Destination Search & Selection */}
            <div className="space-y-2 relative">
              <label className="label text-xs font-semibold flex items-center justify-between">
                <span>Destination (End Point)</span>
                
              </label>

              
              {/* Instant Search Input with Google Maps Style Autocomplete Overlay */}
              <form onSubmit={handleSearchSubmit} className="relative">
                <input
                  type="text"
                  placeholder="Type any City, District, or Town in India & press Enter..."
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

                {/* Autocomplete Suggestions Floating Menu */}
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
                        onClick={() => handleSelectDestination(loc)}
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
              </form>

              {/* Select Dropdown List */}
              <div className="space-y-1 pt-1">
                <p className="text-[10px] text-ink-faint uppercase font-mono">Or Pick from List:</p>
                <select
                  className="input text-xs font-mono w-full"
                  value={selectedDest ? destOptions.findIndex((o) => o.lat === selectedDest?.lat && o.lng === selectedDest?.lng) : -1}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    if (idx >= 0 && destOptions[idx]) {
                      handleSelectDestination(destOptions[idx]);
                    }
                  }}
                >
                  <option value={-1} disabled>-- Select Destination Location --</option>
                  {destOptions.map((loc, idx) => (
                    <option key={idx} value={idx}>📍 {loc.name} {loc.isNer ? "🏔 (NER)" : ""}</option>
                  ))}
                </select>
              </div>

              {/* Action Button: Calculate & Find Route */}
              <button
                type="button"
                onClick={handleSearchSubmit}
                disabled={routeLoading}
                className="btn-primary w-full py-2.5 text-xs font-bold uppercase tracking-wider bg-signal text-base-panel hover:bg-signal/90 shadow-md flex items-center justify-center gap-2 mt-2"
              >
                <span>🚀</span>
                <span>{routeLoading ? "Calculating Navigation Route..." : "Calculate Route & Navigate"}</span>
              </button>
            </div>

            {/* Vehicle Mode Selector */}
            <div className="space-y-2 pt-2 border-t border-base-border">
              <label className="label text-xs font-semibold">Mode of Travel / Vehicle Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {VEHICLE_MODES.map((v) => {
                  const active = selectedVehicle.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVehicle(v)}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        active
                          ? "bg-signal/15 border-signal text-signal font-bold shadow-sm"
                          : "bg-base-raised border-base-border text-ink-muted hover:text-ink"
                      }`}
                    >
                      <div className="text-xl mb-0.5">{v.icon}</div>
                      <div className="text-[11px] truncate font-medium">{v.label}</div>
                      <div className="text-[9px] font-mono text-ink-faint">{v.speedKmh} km/h</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleCalculateRoute}
              disabled={routeLoading}
              className="btn-primary w-full py-3 text-xs font-bold uppercase tracking-wider shadow-md"
            >
              {routeLoading ? "Calculating Pan-India Route…" : "🧭 Compute Route & Navigation"}
            </button>

            {routeError && <p className="text-xs text-risk-veryhigh font-mono">{routeError}</p>}
          </div>

          {/* Route Summary & ETA Stats */}
          {activeRoute && etaCalculation && (
            <div className="panel p-4 space-y-3 bg-base-raised/80">
              <h3 className="eyebrow text-signal">Navigation Route Overview</h3>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 bg-base-panel rounded border border-base-border">
                  <p className="text-[10px] text-ink-faint uppercase font-mono">Distance</p>
                  <p className="text-base sm:text-lg font-mono font-bold text-signal">{activeRoute.distanceKm.toFixed(1)} km</p>
                </div>

                <div className="p-2.5 bg-base-panel rounded border border-base-border">
                  <p className="text-[10px] text-ink-faint uppercase font-mono">Est. Travel Time</p>
                  <p className="text-base sm:text-lg font-mono font-bold text-ink">{formatDuration(etaCalculation.minutes)}</p>
                </div>

                <div className="p-2.5 bg-base-panel rounded border border-base-border">
                  <p className="text-[10px] text-ink-faint uppercase font-mono">Expected ETA</p>
                  <p className="text-xs sm:text-sm font-mono font-semibold text-ink">{formatEta(etaArrivalTime)}</p>
                </div>

                <div className="p-2.5 bg-base-panel rounded border border-base-border">
                  <p className="text-[10px] text-ink-faint uppercase font-mono">Avg Speed</p>
                  <p className="text-xs sm:text-sm font-mono font-semibold text-ink">{etaCalculation.adjustedSpeedKmh} km/h</p>
                </div>
              </div>

              <div className="p-2.5 rounded bg-base-panel border border-base-border text-xs space-y-1">
                <p className="text-ink-muted"><span className="font-bold text-ink">Mode:</span> {selectedVehicle.icon} {selectedVehicle.label}</p>
                <p className="text-ink-muted"><span className="font-bold text-ink">Corridor Weather:</span> {weather?.condition?.replace("_", " ") || "Clear"}</p>
                <p className="text-ink-muted"><span className="font-bold text-ink">Active Hazards En Route:</span> {incidents.length} reported hazard(s)</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (2 Spans): Interactive Route Map & Turn-by-Turn Navigation HUD */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live Turn-by-Turn Navigation HUD Header Bar */}
          {activeRoute && (
            <div className={`panel p-3 border-2 transition-all ${isNavigating ? 'bg-signal/15 border-signal shadow-lg' : 'bg-base-panel border-base-border'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl p-2 rounded-lg bg-base-raised border border-base-border shadow-inner shrink-0 animate-bounce">
                    {activeTurnStep?.icon || "🧭"}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-signal bg-signal/20 px-2 py-0.5 rounded">
                        Step {currentStepIdx + 1} of {turnSteps.length}
                      </span>
                      {isNavigating && (
                        <span className="text-[10px] font-mono font-bold text-risk-veryhigh animate-pulse flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-risk-veryhigh animate-ping" />
                          LIVE GUIDANCE ACTIVE
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-ink mt-0.5">{activeTurnStep?.title}</h3>
                    <p className="text-xs text-ink-muted">{activeTurnStep?.detail}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isNavigating ? (
                    <>
                      <button
                        type="button"
                        disabled={currentStepIdx === 0}
                        onClick={() => setCurrentStepIdx((prev) => Math.max(0, prev - 1))}
                        className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40"
                      >
                        ⏮ Prev
                      </button>
                      <button
                        type="button"
                        disabled={currentStepIdx >= turnSteps.length - 1}
                        onClick={() => setCurrentStepIdx((prev) => Math.min(turnSteps.length - 1, prev + 1))}
                        className="btn-primary text-xs py-1.5 px-3 bg-signal text-base-panel font-bold"
                      >
                        Next Step ⏭
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsNavigating(false)}
                        className="btn-secondary text-xs py-1.5 px-3 border-risk-veryhigh/50 text-risk-veryhigh hover:bg-risk-veryhigh/10 font-bold"
                      >
                        ⏹ Stop Guidance
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsNavigating(true);
                        setCurrentStepIdx(0);
                      }}
                      className="btn-primary flex items-center gap-2 bg-signal hover:bg-signal/90 text-base-panel font-bold py-2 px-4 rounded-lg shadow-lg text-xs uppercase tracking-wider"
                    >
                      <span>🚀 Start Turn-by-Turn Live Navigation</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Interactive Red Route Map */}
          <div className="panel p-2 sm:p-3 relative">
            <RouteMap
              source={currentOrigin}
              destination={selectedDest}
              current={geo.position ? { lat: geo.position.lat, lng: geo.position.lng } : null}
              recommendedPath={activeRoute?.overviewPath}
              alternatePath={routeResult?.alternate?.overviewPath}
              incidents={incidents}
              height={window.innerWidth < 640 ? 360 : 520}
            />
          </div>

          {/* Complete Step-by-Step Itinerary Timeline: Start to End */}
          {activeRoute && (
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-base-border pb-2">
                <h3 className="eyebrow text-signal flex items-center gap-1.5">
                  <span>🗺 Full Step-by-Step Route Guidance (Start → End)</span>
                </h3>
                <span className="text-[10px] font-mono text-ink-faint">
                  {turnSteps.length} Navigation Checkpoints
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono max-h-72 overflow-y-auto pr-1 divide-y divide-base-border/40">
                {turnSteps.map((step, idx) => {
                  const isActive = idx === currentStepIdx;
                  return (
                    <div
                      key={step.id || idx}
                      onClick={() => {
                        setCurrentStepIdx(idx);
                        setIsNavigating(true);
                      }}
                      className={`p-3 rounded-lg cursor-pointer transition-all flex items-start justify-between gap-3 ${
                        isActive
                          ? "bg-signal/15 border-2 border-signal shadow-md text-ink"
                          : step.isDanger
                          ? "bg-risk-veryhigh/10 border border-risk-veryhigh/40 hover:bg-risk-veryhigh/20"
                          : "bg-base-raised border border-base-border hover:border-signal/50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl p-1.5 rounded bg-base-panel border border-base-border shrink-0 mt-0.5">
                          {step.icon}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isActive ? 'bg-signal text-base-panel' : 'bg-base-panel text-ink-muted'}`}>
                              STEP {idx + 1}
                            </span>
                            <span className="text-[10px] font-bold text-ink-muted uppercase">{step.maneuver}</span>
                          </div>
                          <p className="font-bold text-ink text-xs mt-1">{step.title}</p>
                          <p className="text-[11px] text-ink-muted mt-0.5 font-sans leading-relaxed">{step.detail}</p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-bold text-signal">{step.distKm} km</span>
                        <p className="text-[9px] text-ink-faint">From Start</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Guest Name & Phone Number Entry Modal */}
      {showGuestInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel max-w-sm w-full p-6 space-y-4 border-signal/40 shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>🧭</span>
                <span>Enter Name & Phone Number</span>
              </h2>
              <button onClick={() => setShowGuestInfoModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <p className="text-xs text-ink-muted">Please enter your name and phone number to use live GPS navigation and hazard reporting.</p>

            <form onSubmit={handleSaveGuestInfo} className="space-y-3">
              <div>
                <label className="label text-xs">Your Full Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder="e.g. Alex, Rahul, Sarah..."
                  className="input font-medium text-xs"
                />
              </div>

              <div>
                <label className="label text-xs">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={inputPhone}
                  onChange={(e) => setInputPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="input font-medium text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowGuestInfoModal(false)} className="btn-secondary flex-1 text-xs">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1 font-bold text-xs bg-signal text-base-panel">
                  Start Navigation 🚀
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full AI Vision & Voice Hazard Report Modal */}
      <ReportHazardModal
        isOpen={showHazardModal}
        onClose={() => setShowHazardModal(false)}
        defaultPos={geo.position ? { lat: geo.position.lat, lng: geo.position.lng } : (currentOrigin.lat ? { lat: currentOrigin.lat, lng: currentOrigin.lng } : null)}
        onSuccess={loadIncidentsAndEnvironment}
      />
    </div>
  );
}
