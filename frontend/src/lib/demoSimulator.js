import { supabase } from "./supabaseClient";

// ============================================================================
// DEMO MODE simulator.
//
// Everything this module writes is tagged source: 'demo' in the database so
// it can never be confused with real GPS/weather/incident data. It exists so
// the full workflow (shipment -> GPS -> risk -> reroute -> alert -> delivery)
// can be demonstrated end-to-end without live hardware or paid weather APIs.
// ============================================================================

/** Interpolate a point at fraction t (0-1) along a path of {lat,lng}. */
export function pointAlongPath(path, t) {
  if (!path || path.length === 0) return null;
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, t));
  const segCount = path.length - 1;
  const segT = clamped * segCount;
  const idx = Math.min(Math.floor(segT), segCount - 1);
  const localT = segT - idx;
  const a = path[idx];
  const b = path[idx + 1];
  return {
    lat: a.lat + (b.lat - a.lat) * localT,
    lng: a.lng + (b.lng - a.lng) * localT,
  };
}

/**
 * Push one simulated GPS ping for a shipment, advancing progress `step`
 * (0-1 fraction of the route) further along the recommended path.
 */
export async function simulateGpsTick({ shipmentId, driverId, path, progress, step = 0.02 }) {
  const nextProgress = Math.min(1, progress + step);
  const point = pointAlongPath(path, nextProgress);
  if (!point) return { progress: nextProgress, point: null };

  await supabase.from("gps_locations").insert({
    shipment_id: shipmentId,
    driver_id: driverId,
    lat: point.lat,
    lng: point.lng,
    speed_kmh: 30 + Math.random() * 20,
    heading: 0,
    source: "demo",
  });

  return { progress: nextProgress, point };
}

/** Inject a DEMO weather event near a location and return the row inserted. */
export async function simulateWeatherEvent({ lat, lng, region, condition = "heavy_rain", rainfallMm = 45 }) {
  const { data, error } = await supabase
    .from("weather_conditions")
    .insert({
      region: region || "Simulated corridor",
      lat,
      lng,
      condition,
      rainfall_mm: rainfallMm,
      source: "demo",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Inject a DEMO road status change (block / at-risk) near a location. */
export async function simulateRoadEvent({ lat, lng, segment, status = "blocked", reason = "Landslide reported" }) {
  const { data, error } = await supabase
    .from("road_conditions")
    .insert({
      road_segment: segment || "Simulated segment",
      lat,
      lng,
      status,
      reason,
      source: "demo",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Inject a DEMO incident (landslide / flood / accident). */
export async function simulateIncident({ lat, lng, type = "landslide", severity = "high", description }) {
  const { data, error } = await supabase
    .from("incidents")
    .insert({
      type,
      lat,
      lng,
      severity,
      description: description || `Simulated ${type.replace("_", " ")} event`,
      source: "demo",
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Create an alert row following the WHAT/WHERE/WHEN/SEVERITY/ACTION shape. */
export async function createAlert({
  shipmentId,
  organizationId,
  type,
  what,
  whereText,
  severity,
  recommendedAction,
}) {
  const { data, error } = await supabase
    .from("alerts")
    .insert({
      shipment_id: shipmentId,
      organization_id: organizationId,
      type,
      what,
      where_text: whereText,
      severity,
      recommended_action: recommendedAction,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** The canned "medicine shipment" demo scenario described in the product brief. */
export const DEMO_SCENARIO_STEPS = [
  "Primary User creates a CRITICAL medicine shipment",
  "Driver is assigned and presses START JOURNEY",
  "GPS simulation begins, map shows live position",
  "Heavy rainfall is injected on the corridor",
  "Risk score rises (e.g. 35 -> 72), road marked at-risk",
  "Alternate route is evaluated and recommended",
  "Primary User and Driver receive a rerouting alert",
  "Driver reaches destination and marks delivery complete",
  "Shipment becomes DELIVERED, Admin dashboard updates",
];
