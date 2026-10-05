// ============================================================================
// PROTOTYPE historical hazard / GIS risk layer.
// ----------------------------------------------------------------------------
// This estimates "how disaster-prone has this area historically been" from a
// transparent, rule-weighted heuristic built on well-documented, publicly
// known regional hazard patterns in North East India: seasonal Brahmaputra
// and Barak valley flooding, and monsoon-triggered landslides across the
// hill states (Meghalaya, Mizoram, Manipur, Nagaland, Arunachal Pradesh,
// Sikkim).
//
// This is NOT sourced from a live historical-incident database — it is a
// distance-and-season weighted zone model, same spirit as riskEngine.js's
// "prototype risk model": simple, explainable, and built to be swapped out.
// To upgrade to real data, replace NER_HAZARD_ZONES with polygons/scores
// pulled from a proper hazard atlas (e.g. NDMA / ASDMA / Bhuvan GIS layers)
// — every function below is written against the same shape, so nothing
// downstream (riskEngine, CreateShipment, ShipmentDetail) needs to change.
// ============================================================================

export const NER_HAZARD_ZONES = [
  { name: "Brahmaputra Valley (Guwahati–Dibrugarh corridor)", lat: 26.6, lng: 93.0, radiusKm: 160, type: "flood", baseScore: 45, monsoonBoost: 35 },
  { name: "Barak Valley (Silchar)", lat: 24.83, lng: 92.78, radiusKm: 90, type: "flood", baseScore: 40, monsoonBoost: 30 },
  { name: "Meghalaya Hills (Shillong plateau)", lat: 25.58, lng: 91.89, radiusKm: 100, type: "landslide", baseScore: 35, monsoonBoost: 25 },
  { name: "Mizoram Hills (Aizawl)", lat: 23.73, lng: 92.72, radiusKm: 110, type: "landslide", baseScore: 40, monsoonBoost: 25 },
  { name: "Manipur Hills (Imphal–Churachandpur corridor)", lat: 24.6, lng: 93.85, radiusKm: 100, type: "landslide", baseScore: 30, monsoonBoost: 20 },
  { name: "Nagaland Hills (Kohima–Dimapur corridor)", lat: 25.8, lng: 94.0, radiusKm: 100, type: "landslide", baseScore: 30, monsoonBoost: 20 },
  { name: "Arunachal Pradesh Hills (Itanagar)", lat: 27.08, lng: 93.6, radiusKm: 130, type: "landslide_seismic", baseScore: 35, monsoonBoost: 25 },
  { name: "Sikkim Himalaya (Gangtok)", lat: 27.34, lng: 88.6, radiusKm: 90, type: "landslide_seismic", baseScore: 40, monsoonBoost: 25 },
  { name: "Tripura (Agartala)", lat: 23.83, lng: 91.29, radiusKm: 90, type: "flood", baseScore: 25, monsoonBoost: 20 },
];

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isMonsoonSeason(date = new Date()) {
  const m = date.getMonth(); // 0-indexed
  return m >= 5 && m <= 8; // June - September
}

/** Historical hazard score (0-100) for a single point, plus which zone drove it. */
export function getHazardScore({ lat, lng }, date = new Date()) {
  const monsoon = isMonsoonSeason(date);
  let best = { score: 4, zone: null }; // small baseline "unmapped terrain" risk

  for (const zone of NER_HAZARD_ZONES) {
    const d = distanceKm({ lat, lng }, zone);
    if (d > zone.radiusKm) continue;
    const proximity = 1 - d / zone.radiusKm; // 0..1, 1 = at the zone center
    const seasonal = monsoon ? zone.monsoonBoost : zone.monsoonBoost * 0.2;
    const score = Math.min(100, zone.baseScore * proximity + seasonal * proximity);
    if (score > best.score) best = { score, zone };
  }

  return {
    score: Math.round(best.score),
    zone: best.zone?.name || null,
    hazardType: best.zone?.type || null,
    isMonsoonSeason: monsoon,
  };
}

/** Sample a route path and summarize historical hazard exposure across it. */
export function getHazardAlongPath(path, date = new Date()) {
  if (!path || path.length === 0) {
    return {
      maxScore: 0, avgScore: 0, zonesTouched: [],
      isMonsoonSeason: isMonsoonSeason(date), dominantTerrain: "plain",
      explanation: "No route data.",
    };
  }

  const samples = path.map((p) => getHazardScore(p, date));
  const maxScore = Math.max(...samples.map((s) => s.score));
  const avgScore = samples.reduce((a, s) => a + s.score, 0) / samples.length;
  const zonesTouched = [...new Set(samples.map((s) => s.zone).filter(Boolean))];
  const landslideSamples = samples.filter((s) => s.hazardType?.includes("landslide")).length;
  const dominantTerrain = landslideSamples > samples.length * 0.3 ? "hill" : zonesTouched.length ? "mixed" : "plain";

  const explanation = zonesTouched.length
    ? `Route passes through historically hazard-prone area${zonesTouched.length > 1 ? "s" : ""}: ${zonesTouched.join(", ")}` +
      `${isMonsoonSeason(date) ? " — monsoon season, elevated flood/landslide likelihood." : "."}`
    : "Route does not pass through any mapped historical hazard zone.";

  return {
    maxScore: Math.round(maxScore),
    avgScore: Math.round(avgScore),
    zonesTouched,
    isMonsoonSeason: isMonsoonSeason(date),
    dominantTerrain,
    explanation,
  };
}
