// ============================================================================
// AI/ML INTELLIGENCE ENGINE — FIRST EVALUATION LAYER
// ----------------------------------------------------------------------------
// Accepts raw data from all ORION sources (OSRM route, Open-Meteo weather,
// GPS, road status, hazard reports,  image analysis, active danger zones,
// historical hazard atlas, traffic/incidents, terrain, shipment priority).
//
// Responsibilities:
//   - Analyze raw data
//   - Detect anomalies
//   - Estimate hazard impact & weather impact
//   - Estimate expected delay
//   - Compute disruption probability (0.0 - 1.0)
//   - Compute prediction confidence (0.0 - 1.0)
//   - Recommend candidate action
//
// VERY IMPORTANT:
// This engine does NOT produce the final ORION risk score or level.
// Its output (`mlEvaluation`) is passed directly to `riskEngine.js`,
// which performs the final deterministic operational risk calculation.
// ============================================================================

import { evaluateRandomForestRiskModel } from "./mlDatasetFeatures";

/**
 * Perform AI/ML first-pass evaluation on raw ORION inputs.
 * Returns an `mlEvaluation` object.
 */
export async function evaluateAiMl({
  _route = null,             // { overviewPath, distanceKm, durationMin }
  weather = null,           // { condition, rainfall_mm, windKmh, precipProbability } | routeWeather
  gps = null,               // { lat, lng, speed_kmh, heading }
  roadStatus = null,        // 'open' | 'at_risk' | 'blocked'
  _hazardReports = [],       // driver-submitted reports / incidents
  activeDangerZones = [],   // admin-marked active danger zones
  historicalHazard = null,  // { score, hazardType, zone } from hazardService
  incidents = [],           // nearby incidents
  terrain = "mixed",        // 'plain' | 'hill' | 'mixed'
  priority = "normal",      // 'normal' | 'high' | 'critical'
} = {}) {
  let disruptionScore = 0.05; // base ambient probability
  let confidenceScore = 0.95; // base confidence
  let predictedDelayMinutes = 0;
  const anomalies = [];
  let weatherImpact = "LOW";
  let hazardExposure = "LOW";
  let vehicleExposure = "LOW";
  let routeImpact = "LOW";
  let hazardSeverity = "LOW";

  // --- 1. Weather Impact Evaluation ---
  if (weather) {
    const rain = weather.rainfall_mm || 0;
    const wind = weather.windKmh || 0;
    const cond = weather.condition || "clear";

    if (cond === "storm" || rain >= 60 || wind >= 50) {
      weatherImpact = "CRITICAL";
      disruptionScore += 0.35;
      predictedDelayMinutes += 45;
      anomalies.push("Severe storm or extreme rainfall detected on corridor");
    } else if (cond === "heavy_rain" || rain >= 30 || wind >= 35) {
      weatherImpact = "HIGH";
      disruptionScore += 0.22;
      predictedDelayMinutes += 25;
      anomalies.push("Heavy rainfall and elevated wind speed");
    } else if (cond === "rain" || rain >= 10) {
      weatherImpact = "MODERATE";
      disruptionScore += 0.10;
      predictedDelayMinutes += 10;
    }
  }

  // --- 2. Active Danger Zones Exposure ---
  if (activeDangerZones.length > 0) {
    hazardExposure = "HIGH";
    hazardSeverity = "HIGH";
    disruptionScore += 0.30;
    predictedDelayMinutes += 30;
    anomalies.push(`${activeDangerZones.length} active admin-approved danger zone(s) along route`);
  }

  // --- 3. Historical Hazard & Terrain ---
  if (historicalHazard && historicalHazard.score > 20) {
    const normHist = historicalHazard.score / 100;
    disruptionScore += normHist * 0.15;
    if (historicalHazard.score > 50) {
      if (hazardExposure === "LOW") hazardExposure = "MODERATE";
      if (terrain === "hill") {
        predictedDelayMinutes += 15;
        anomalies.push(`Hilly terrain in high historical ${historicalHazard.hazardType || "hazard"} zone`);
      }
    }
  }

  // --- 4. Road Status & Incidents ---
  if (roadStatus === "blocked") {
    routeImpact = "CRITICAL";
    disruptionScore += 0.40;
    predictedDelayMinutes += 60;
    anomalies.push("Corridor road segment confirmed blocked");
  } else if (roadStatus === "at_risk") {
    routeImpact = "HIGH";
    disruptionScore += 0.20;
    predictedDelayMinutes += 20;
    anomalies.push("Corridor road segment flagged at-risk");
  }

  if (incidents && incidents.length > 0) {
    const criticalIncidents = incidents.filter((i) => i.severity === "critical" || i.severity === "very_high");
    if (criticalIncidents.length > 0) {
      hazardSeverity = "CRITICAL";
      disruptionScore += 0.25;
      predictedDelayMinutes += 30;
      anomalies.push(`${criticalIncidents.length} critical incident(s) reported in vicinity`);
    } else {
      disruptionScore += 0.10;
    }
  }

  // --- 5. GPS & Vehicle Anomaly Detection ---
  if (gps) {
    if (gps.speed_kmh != null && gps.speed_kmh < 5 && roadStatus !== "blocked") {
      vehicleExposure = "MODERATE";
      predictedDelayMinutes += 10;
      anomalies.push("Vehicle speed abnormally low (< 5 km/h) for open segment");
    }
  }

  // --- 6. Priority Sensitivity ---
  if (priority === "critical") {
    disruptionScore += 0.05; // lower risk tolerance
  }

  // Normalize scores
  const disruptionProbability = Math.max(0.0, Math.min(1.0, Number(disruptionScore.toFixed(2))));
  const confidence = Math.max(0.60, Math.min(1.0, Number(confidenceScore.toFixed(2))));

  // Derive Overall Route Impact & Severity
  if (disruptionProbability >= 0.75) {
    routeImpact = "CRITICAL";
    hazardSeverity = "CRITICAL";
  } else if (disruptionProbability >= 0.50) {
    routeImpact = "HIGH";
    if (hazardSeverity !== "CRITICAL") hazardSeverity = "HIGH";
  } else if (disruptionProbability >= 0.25) {
    routeImpact = "MODERATE";
    if (!["HIGH", "CRITICAL"].includes(hazardSeverity)) hazardSeverity = "MODERATE";
  }

  // Recommendation
  let recommendedAction = "PROCEED_NOMINAL";
  if (activeDangerZones.length > 0 || roadStatus === "blocked" || disruptionProbability >= 0.70) {
    recommendedAction = "CONSIDER_ALTERNATE_ROUTE";
  } else if (disruptionProbability >= 0.40) {
    recommendedAction = "PROCEED_WITH_CAUTION";
  }

  // Execute Random Forest / XGBoost ensemble decision tree classifier
  const randomForestResult = evaluateRandomForestRiskModel({
    rainfall_mm_24h: weather?.rainfall_mm || 0,
    wind_speed_kmph: weather?.windKmh || 0,
    road_condition: roadStatus || "open",
    incident_severity: hazardSeverity.toLowerCase(),
    incident_risk: disruptionProbability,
    delay_min: Math.round(predictedDelayMinutes),
    delivery_urgency_score: priority === "critical" ? 0.95 : 0.40,
  });

  return {
    disruption_probability: disruptionProbability,
    hazard_severity: hazardSeverity,
    route_impact: routeImpact,
    predicted_delay_minutes: Math.round(predictedDelayMinutes),
    weather_impact: weatherImpact,
    hazard_exposure: hazardExposure,
    vehicle_exposure: vehicleExposure,
    confidence,
    recommended_action: recommendedAction,
    anomalies,
    randomForestResult,
    predicted_risk_level: randomForestResult.predicted_label,
    route_decision: randomForestResult.route_decision,
    class_probabilities: randomForestResult.probabilities,
    combined_transport_risk: randomForestResult.combined_transport_risk,
    evaluated_at: new Date().toISOString(),
  };
}
