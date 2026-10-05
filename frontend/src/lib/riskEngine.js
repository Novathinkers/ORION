// ============================================================================
// ORION MATHEMATICAL RISK ENGINE (`riskEngine.js`)
// ----------------------------------------------------------------------------
// PIPELINE EXECUTION ORDER (STRICT):
// Raw ORION Data -> AI/ML Engine (`aiMlEngine.js`) -> `mlEvaluation`
//                -> `riskEngine.js` -> Mathematical Risk Formula
//                -> Final Risk Score (0 - 100) -> LOW / MEDIUM / HIGH / CRITICAL
// ============================================================================

import { evaluateAiMl } from "./aiMlEngine";

export const RISK_BANDS = [
  { max: 25, level: "LOW", color: "risk-low" },
  { max: 50, level: "MEDIUM", color: "risk-moderate" },
  { max: 75, level: "HIGH", color: "risk-high" },
  { max: 100, level: "CRITICAL", color: "risk-critical" },
];

export function riskLevelFor(score) {
  return RISK_BANDS.find((b) => score <= b.max) || RISK_BANDS[RISK_BANDS.length - 1];
}

/**
 * DEFAULT CONFIGURABLE WEIGHTS
 * Sum of weights = 1.0 (100% total contribution)
 * Disruption probability & hazard severity from AI/ML Engine carry significant weight.
 */
export const DEFAULT_RISK_WEIGHTS = {
  weather: 0.18,        // w1: Severe rain / storm / wind
  hazard: 0.15,         // w2: Driver reported hazards & incidents nearby
  roadCondition: 0.20,  // w3: Road segment status (open vs at_risk vs blocked)
  historicalHazard: 0.10, // w4: GIS historical hazard exposure
  dangerZone: 0.15,     // w5: Confirmed admin active danger zones
  vehicle: 0.07,        // w6: Route deviation, low speed, terrain
  aiMlDisruption: 0.15, // w7: AI/ML Engine disruption probability prediction (M)
};

/**
 * Compute dynamic mathematical risk score for a shipment.
 *
 * Mathematical Formula:
 *   Risk Score = [ (W * w1) + (H * w2) + (R * w3) + (HH * w4) + (D * w5) + (V * w6) + (M * w7) ] * 100
 *
 * Each factor (W, H, R, HH, D, V, M) is normalized between 0.0 and 1.0.
 */
export function computeRisk({
  weather,           // { condition, rainfall_mm, windKmh } | null
  nearbyIncidents,   // array of { type, severity, status }
  roadStatus,        // 'open' | 'at_risk' | 'blocked' | null
  priority,          // 'normal' | 'high' | 'critical'
  routeDeviationKm,  // number | null
  terrain,           // 'plain' | 'hill' | 'mixed'
  hazard,            // { score: 0-100, explanation } | null — GIS historical exposure
  activeDangerZones = [], // admin active danger zones
  mlEvaluation = null,    // output from aiMlEngine.evaluateAiMl()
  weights = DEFAULT_RISK_WEIGHTS, // configurable weights
}) {
  const factors = [];

  // --- 1. Weather Risk Factor (W: 0.0 - 1.0) ---
  let W = 0.0;
  if (weather) {
    const rain = weather.rainfall_mm || 0;
    const wind = weather.windKmh || 0;
    if (weather.condition === "storm" || rain >= 60 || wind >= 50) {
      W = 1.0;
      factors.push({ label: "Severe storm / extreme rainfall", value: W, weight: weights.weather, points: Math.round(W * weights.weather * 100) });
    } else if (weather.condition === "heavy_rain" || rain >= 30 || wind >= 35) {
      W = 0.65;
      factors.push({ label: "Heavy rainfall & elevated wind", value: W, weight: weights.weather, points: Math.round(W * weights.weather * 100) });
    } else if (weather.condition === "rain" || rain >= 10) {
      W = 0.35;
      factors.push({ label: "Moderate rainfall", value: W, weight: weights.weather, points: Math.round(W * weights.weather * 100) });
    }
  }

  // --- 2. Hazard Risk Factor (H: 0.0 - 1.0) ---
  let H = 0.0;
  const validIncidents = nearbyIncidents || [];
  if (validIncidents.length > 0) {
    const maxSev = Math.max(
      ...validIncidents.map((i) => {
        const s = (i.severity || "moderate").toLowerCase();
        if (s === "critical" || i.status === "blocked") return 1.0;
        if (s === "very_high" || s === "high") return 0.75;
        if (s === "moderate") return 0.45;
        return 0.2;
      })
    );
    H = maxSev;
    factors.push({ label: `${validIncidents.length} nearby incident(s) reported`, value: H, weight: weights.hazard, points: Math.round(H * weights.hazard * 100) });
  }

  // --- 3. Road Condition Risk Factor (R: 0.0 - 1.0) ---
  let R = 0.0;
  if (roadStatus === "blocked") {
    R = 1.0;
    factors.push({ label: "Road segment confirmed BLOCKED", value: R, weight: weights.roadCondition, points: Math.round(R * weights.roadCondition * 100) });
  } else if (roadStatus === "at_risk") {
    R = 0.5;
    factors.push({ label: "Road segment flagged AT RISK", value: R, weight: weights.roadCondition, points: Math.round(R * weights.roadCondition * 100) });
  }

  // --- 4. Historical Hazard Risk Factor (HH: 0.0 - 1.0) ---
  let HH = 0.0;
  if (hazard && hazard.score > 0) {
    HH = Math.min(1.0, hazard.score / 100);
    factors.push({ label: hazard.explanation || "GIS historical hazard exposure", value: HH, weight: weights.historicalHazard, points: Math.round(HH * weights.historicalHazard * 100) });
  }

  // --- 5. Danger Zone Risk Factor (D: 0.0 - 1.0) ---
  let D = 0.0;
  if (activeDangerZones && activeDangerZones.length > 0) {
    D = Math.min(1.0, activeDangerZones.length * 0.5);
    factors.push({ label: `${activeDangerZones.length} admin active danger zone(s)`, value: D, weight: weights.dangerZone, points: Math.round(D * weights.dangerZone * 100) });
  }

  // --- 6. Vehicle Risk Factor (V: 0.0 - 1.0) ---
  let V = 0.0;
  if (terrain === "hill") V += 0.35;
  else if (terrain === "mixed") V += 0.15;

  if (routeDeviationKm && routeDeviationKm > 5) V += 0.45;
  if (priority === "critical") V += 0.20;

  V = Math.min(1.0, V);
  if (V > 0) {
    factors.push({ label: "Terrain / Route deviation / Cargo priority sensitivity", value: V, weight: weights.vehicle, points: Math.round(V * weights.vehicle * 100) });
  }

  // --- 7. AI/ML Disruption Probability Factor (M: 0.0 - 1.0) ---
  let M = 0.0;
  if (mlEvaluation && mlEvaluation.disruption_probability != null) {
    M = Math.min(1.0, mlEvaluation.disruption_probability);
    factors.push({
      label: `AI/ML Disruption Index (${Math.round(M * 100)}% prob)`,
      value: M,
      weight: weights.aiMlDisruption,
      points: Math.round(M * weights.aiMlDisruption * 100),
    });
  }

  // --- WEIGHTED MATHEMATICAL CALCULATION ---
  const weightedSum =
    W * weights.weather +
    H * weights.hazard +
    R * weights.roadCondition +
    HH * weights.historicalHazard +
    D * weights.dangerZone +
    V * weights.vehicle +
    M * weights.aiMlDisruption;

  const rawScore = Math.round(weightedSum * 100);
  // Baseline ambient risk score minimum of 5 if no major factors present
  const score = Math.max(5, Math.min(100, rawScore));
  const band = riskLevelFor(score);

  const explanation =
    factors.length === 0
      ? "No elevated risk factors detected. Operational conditions nominal."
      : `Operational Risk is ${band.level} (${score}/100). Primary mathematical contributors: ` +
        factors.map((f) => `${f.label} (+${f.points} pts)`).join(", ") + ".";

  return {
    score,
    level: band.level,
    colorToken: band.color,
    factors: { W, H, R, HH, D, V, M },
    factorBreakdown: factors,
    explanation,
    mlEvaluation,
    predicted_risk_level: mlEvaluation?.predicted_risk_level || band.level,
    route_decision: mlEvaluation?.route_decision || "Yes - route can be used",
    class_probabilities: mlEvaluation?.class_probabilities || null,
    combined_transport_risk: mlEvaluation?.combined_transport_risk || score,
    weights,
  };
}

export const VEHICLE_SPEED_PROFILES = {
  heavy_truck: { baseSpeedKmh: 45, label: "Heavy Truck / Trailer (45 km/h)", key: "heavy_truck" },
  truck: { baseSpeedKmh: 55, label: "Standard Truck (55 km/h)", key: "truck" },
  van: { baseSpeedKmh: 65, label: "Delivery Van (65 km/h)", key: "van" },
  car: { baseSpeedKmh: 75, label: "Car / Light Commercial (75 km/h)", key: "car" },
  two_wheeler: { baseSpeedKmh: 50, label: "Two-Wheeler / Bike (50 km/h)", key: "two_wheeler" },
  walking: { baseSpeedKmh: 5, label: "Walking (5 km/h)", key: "walking" },
  default: { baseSpeedKmh: 50, label: "Standard Vehicle (50 km/h)", key: "default" },
};

export function getVehicleBaseSpeed(vehicleType) {
  if (!vehicleType) return VEHICLE_SPEED_PROFILES.default.baseSpeedKmh;
  const key = String(vehicleType).toLowerCase().replace(/[\s-]/g, "_");
  if (key.includes("walk") || key.includes("pedestrian")) return VEHICLE_SPEED_PROFILES.walking.baseSpeedKmh;
  if (key.includes("heavy") || key.includes("trailer") || key.includes("container")) return VEHICLE_SPEED_PROFILES.heavy_truck.baseSpeedKmh;
  if (key.includes("van") || key.includes("pickup") || key.includes("light")) return VEHICLE_SPEED_PROFILES.van.baseSpeedKmh;
  if (key.includes("car") || key.includes("taxi") || key.includes("suv") || key.includes("sedan")) return VEHICLE_SPEED_PROFILES.car.baseSpeedKmh;
  if (key.includes("bike") || key.includes("scooter") || key.includes("two") || key.includes("motorcycle")) return VEHICLE_SPEED_PROFILES.two_wheeler.baseSpeedKmh;
  if (key.includes("truck") || key.includes("lorry")) return VEHICLE_SPEED_PROFILES.truck.baseSpeedKmh;
  return VEHICLE_SPEED_PROFILES.default.baseSpeedKmh;
}

/** Recompute ETA from remaining distance + a speed adjusted for vehicle type and road/weather conditions. */
export function computeEta({ remainingKm, vehicleType, baseSpeedKmh = null, weather, roadStatus }) {
  const baseSpeed = baseSpeedKmh != null ? baseSpeedKmh : getVehicleBaseSpeed(vehicleType);
  let speed = baseSpeed;
  if (weather?.condition === "storm") speed *= 0.55;
  else if (weather?.condition === "heavy_rain") speed *= 0.7;
  else if (weather?.condition === "rain") speed *= 0.85;

  if (roadStatus === "blocked") speed *= 0.3; // crawling / detouring
  else if (roadStatus === "at_risk") speed *= 0.75;

  speed = Math.max(3, speed);
  const minutes = (remainingKm / speed) * 60;
  return { minutes, adjustedSpeedKmh: Math.round(speed), baseSpeedKmh: baseSpeed };
}

/**
 * Score a single candidate route (recommended or alternate) using live
 * weather + historical GIS hazard exposure.
 *
 * Enforces PIPELINE:
 * RAW DATA -> AI/ML Engine -> mlEvaluation -> riskEngine.js -> FINAL SCORE
 */
export async function scoreRouteOption({
  route,            // { overviewPath, distanceKm, durationMin }
  routeWeather,     // result of weatherService.getRouteWeather()
  hazardSummary,    // result of hazardService.getHazardAlongPath()
  nearbyIncidents = [],
  roadStatus = null,
  activeDangerZones = [],
  priority = "normal",
}) {
  const weatherObj = routeWeather?.worst
    ? { condition: routeWeather.worst.condition, rainfall_mm: routeWeather.worst.rainfall_mm, windKmh: routeWeather.worst.windKmh }
    : null;
  const hazardObj = hazardSummary ? { score: hazardSummary.avgScore, explanation: hazardSummary.explanation, hazardType: hazardSummary.dominantTerrain } : null;

  // 1. AI/ML Engine First Evaluation
  const mlEvaluation = await evaluateAiMl({
    route,
    weather: weatherObj,
    roadStatus,
    activeDangerZones,
    historicalHazard: hazardObj,
    incidents: nearbyIncidents,
    terrain: hazardSummary?.dominantTerrain || "mixed",
    priority,
  });

  // 2. Final Operational Risk Evaluation via Mathematical Calculation
  const risk = computeRisk({
    weather: weatherObj,
    nearbyIncidents,
    roadStatus,
    activeDangerZones,
    priority,
    routeDeviationKm: null,
    terrain: hazardSummary?.dominantTerrain || "mixed",
    hazard: hazardObj,
    mlEvaluation,
  });

  return { route, risk, routeWeather, hazardSummary, mlEvaluation };
}

/**
 * Rank scored route options on a risk-vs-time trade-off.
 */
export function chooseBestRoute(options) {
  const valid = options.filter((o) => o?.route && o?.risk);
  if (valid.length === 0) return null;

  const scored = valid.map((o) => ({
    ...o,
    rankScore: o.risk.score * 1.6 + o.route.durationMin * 0.12,
  }));
  scored.sort((a, b) => a.rankScore - b.rankScore);

  const best = scored[0];
  const runnerUp = scored[1] || null;

  let explanation;
  if (!runnerUp) {
    explanation = `${best.key} route selected — ${best.risk.level} risk (${best.risk.score}/100).`;
  } else if (best.key === runnerUp.key) {
    explanation = `${best.key} route selected.`;
  } else {
    const timeDeltaMin = Math.round(best.route.durationMin - runnerUp.route.durationMin);
    const timeNote =
      timeDeltaMin === 0
        ? "same travel time"
        : timeDeltaMin > 0
        ? `+${timeDeltaMin} min longer`
        : `${Math.abs(timeDeltaMin)} min faster`;
    explanation =
      `${best.key === "recommended" ? "Recommended" : "Alternate"} route is the safer choice: ` +
      `${best.risk.level} risk (${best.risk.score}/100) vs ${runnerUp.risk.level} (${runnerUp.risk.score}/100) ` +
      `on the ${runnerUp.key} route (${timeNote}).`;
  }

  return { best: best.key, ranked: scored, explanation };
}
