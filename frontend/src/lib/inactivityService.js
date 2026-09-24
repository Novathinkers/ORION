// ============================================================================
// ORION DRIVER INACTIVITY & DISASTER ALERT SERVICE (`inactivityService.js`)
// ----------------------------------------------------------------------------
// Continuously monitors driver heartbeat pings and last known GPS location.
// Evaluates 10-minute inactivity thresholds with contextual risk scoring
// (Weather, Hazards, Active Danger Zones, Road Status, Route Context).
// ============================================================================

import { supabase } from "./supabaseClient";

import { listAllShipments, getLatestGpsForActiveShipments, listAllHazardReports, getLatestWeather } from "./dataService";

// In-memory fallback array for real driver inactivity alerts
let memoryInactivityAlerts = [];

/**
 * Scans all active shipments and existing drivers in the database to detect real signal loss (> 3 min).
 */
export async function scanExistingDriversForInactivity() {
  try {
    const shipments = await listAllShipments().catch(() => []);
    const activeShipments = (shipments || []).filter((s) =>
      ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting"].includes(s.status)
    );

    if (activeShipments.length === 0) return [];

    const activeIds = activeShipments.map((s) => s.id);
    const gpsMap = await getLatestGpsForActiveShipments(activeIds).catch(() => ({}));
    const reports = await listAllHazardReports().catch(() => []);
    const weather = await getLatestWeather().catch(() => null);

    const now = Date.now();
    const evaluatedAlerts = [];

    for (const shipment of activeShipments) {
      const gps = gpsMap[shipment.id];
      const driverName = shipment.driver?.full_name || "Assigned Driver";
      const driverPhone = shipment.driver?.phone || "+91 98765 43210";
      const vehicleNo = shipment.vehicle?.registration_no || "TRUCK-REG";
      const companyName = shipment.organization?.name || "ORION Freight";

      // Calculate last recorded activity timestamp from GPS log, Driver Signup Date (created_at), or Shipment Creation
      const gpsTime = gps?.recorded_at ? new Date(gps.recorded_at).getTime() : 0;
      const driverPingTime = shipment.driver?.last_ping_at ? new Date(shipment.driver.last_ping_at).getTime() : 0;
      const driverSignupTime = shipment.driver?.created_at ? new Date(shipment.driver.created_at).getTime() : 0;
      const shipmentCreatedTime = shipment.created_at ? new Date(shipment.created_at).getTime() : 0;

      // The driver's baseline reference timestamp is the latest activity or signup date
      const latestActivityTime = Math.max(gpsTime, driverPingTime, driverSignupTime, shipmentCreatedTime);
      const lastPingTimestamp = latestActivityTime > 0 ? latestActivityTime : now;

      const offlineDurationMinutes = Math.max(0, (now - lastPingTimestamp) / (1000 * 60));

      const lat = gps?.lat || shipment.source_lat || 26.1445;
      const lng = gps?.lng || shipment.source_lng || 91.7362;

      // Evaluate nearby hazards & danger zones for this driver's position
      const nearbyHazards = reports.filter((r) => {
        if (!r.lat || !r.lng) return false;
        const dLat = Math.abs(r.lat - lat);
        const dLng = Math.abs(r.lng - lng);
        return dLat < 0.15 && dLng < 0.15;
      });

      const activeDangerZones = reports.filter((r) => r.is_danger_zone);

      // Perform risk calculation
      const evalResult = evaluateInactivityRisk({
        offlineDurationMinutes,
        weather,
        nearbyIncidents: nearbyHazards,
        activeDangerZones,
        roadStatus: shipment.status === "delayed" ? "at_risk" : "open",
        isMovingBeforeLoss: (gps?.speed_kmh || 0) > 10,
        priority: shipment.priority || "normal",
      });

      // If driver is currently active (< 3 min offline), auto-resolve existing inactivity alerts
      if (offlineDurationMinutes < 3) {
        await resolveAlertOnDriverReconnect(shipment.driver_id, driverName);
      } else {
        // If offline duration exceeds 3 minutes threshold, create or refresh alert
        const alertData = {
          driverId: shipment.driver_id,
          driverName,
          driverPhone,
          vehicleId: shipment.vehicle_id,
          vehicleNo,
          companyId: shipment.organization_id,
          companyName,
          shipmentId: shipment.id,
          lastPingAt: new Date(lastPingTimestamp).toISOString(),
          offlineStartedAt: new Date(lastPingTimestamp).toISOString(),
          offlineDurationMinutes,
          latitude: lat,
          longitude: lng,
          lastSpeedKmh: gps?.speed_kmh || 0,
          weatherRisk: evalResult.weatherRisk,
          hazardRisk: evalResult.hazardRisk,
          dangerZoneRisk: evalResult.dangerZoneRisk,
          roadRisk: evalResult.roadRisk,
          inactivityRisk: evalResult.inactivityFactor,
          finalRiskScore: evalResult.finalRiskScore,
          alertLevel: evalResult.alertLevel,
          status: evalResult.status,
        };

        const alertItem = await createInactivityAlert(alertData);
        evaluatedAlerts.push(alertItem);
      }
    }

    return evaluatedAlerts;
  } catch (err) {
    console.warn("[inactivityService] Error scanning existing drivers:", err);
    return memoryInactivityAlerts;
  }
}

/**
 * Format duration offline into human-readable Hours & Minutes format based on timestamp date
 */
export function formatOfflineDuration(durationMinutes) {
  const mins = Math.max(0, Math.round(durationMinutes || 0));
  if (mins < 60) return `${mins} Mins`;
  const hours = (mins / 60).toFixed(1);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m (${hours} hrs)` : `${hours} Hours`;
}

/**
 * Calculates exact offline hours dynamically from the last ping / location date timestamp
 */
export function formatOfflineDurationFromDate(lastPingAt, fallbackMinutes = 0) {
  if (!lastPingAt) return formatOfflineDuration(fallbackMinutes);
  try {
    const pingDate = new Date(lastPingAt);
    const now = Date.now();
    const diffMs = now - pingDate.getTime();
    if (isNaN(diffMs) || diffMs < 0) return formatOfflineDuration(fallbackMinutes);

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = (diffMs / (1000 * 60 * 60)).toFixed(1);
    const timeStr = pingDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    if (totalMinutes < 60) {
      return `${totalMinutes} Mins (${totalHours} hrs since ${timeStr})`;
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const dateStr = pingDate.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    return `${h}h ${m}m (${totalHours} Hours since ${dateStr} ${timeStr})`;
  } catch {
    return formatOfflineDuration(fallbackMinutes);
  }
}

/**
 * Deduplicate alerts so each driver appears AT MOST ONCE in active lists
 */
export function deduplicateDriverAlerts(alertsList = []) {
  const seen = new Set();
  const unique = [];
  for (const alert of alertsList) {
    const key = alert.driver_name || alert.driver_id || alert.vehicle_no || alert.shipment_id;
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(alert);
    }
  }
  return unique;
}

/**
 * DEFAULT CONFIGURABLE INACTIVITY RISK WEIGHTS
 * Sum of weights = 1.0 (100% total contribution)
 */
export const DEFAULT_INACTIVITY_WEIGHTS = {
  inactivity: 0.30,   // w1: Duration without heartbeat ping
  weather: 0.20,      // w2: Heavy rainfall / storm / wind
  hazard: 0.20,       // w3: Nearby hazard reports & incidents
  dangerZone: 0.15,   // w4: Inside or near admin active danger zone
  road: 0.10,         // w5: Road segment status (blocked vs at_risk)
  routeContext: 0.05, // w6: Active shipment priority & terrain
};

/**
 * Calculate Inactivity Factor (0.0 to 1.0) based on offline duration minutes
 */
export function getInactivityFactor(durationMinutes) {
  if (durationMinutes <= 3) return 0.10;
  if (durationMinutes <= 5) return 0.25;
  if (durationMinutes <= 10) return 0.50;
  if (durationMinutes <= 20) return 0.75;
  return 1.00;
}

/**
 * Perform rule-based mathematical risk scoring for driver inactivity & disaster evaluation.
 */
export function evaluateInactivityRisk({
  offlineDurationMinutes = 0,
  weather = null,           // { condition, rainfall_mm }
  nearbyIncidents = [],     // array of { type, severity, status }
  activeDangerZones = [],   // array of danger zones
  roadStatus = null,        // 'open' | 'at_risk' | 'blocked'
  isMovingBeforeLoss = false, // boolean
  priority = 'normal',      // 'normal' | 'high' | 'critical'
  weights = DEFAULT_INACTIVITY_WEIGHTS,
}) {
  const factors = [];

  // 1. Inactivity Risk Factor (I)
  const I = getInactivityFactor(offlineDurationMinutes);
  factors.push({ label: `Offline duration: ${Math.round(offlineDurationMinutes)} min`, value: I, weight: weights.inactivity });

  // 2. Weather Risk Factor (W)
  let W = 0.0;
  if (weather) {
    const rain = weather.rainfall_mm || 0;
    if (weather.condition === "storm" || rain >= 50) W = 1.0;
    else if (weather.condition === "heavy_rain" || rain >= 25) W = 0.7;
    else if (weather.condition === "rain" || rain >= 10) W = 0.35;
  }
  if (W > 0) factors.push({ label: "Adverse weather & rainfall", value: W, weight: weights.weather });

  // 3. Hazard Risk Factor (H)
  let H = 0.0;
  if (nearbyIncidents.length > 0) {
    const maxSev = Math.max(
      ...nearbyIncidents.map((i) => {
        const s = (i.severity || "moderate").toLowerCase();
        if (s === "critical" || i.status === "blocked") return 1.0;
        if (s === "very_high" || s === "high") return 0.75;
        return 0.4;
      })
    );
    H = maxSev;
    factors.push({ label: `${nearbyIncidents.length} nearby hazard report(s)`, value: H, weight: weights.hazard });
  }

  // 4. Danger Zone Risk Factor (D)
  let D = activeDangerZones.length > 0 ? 1.0 : 0.0;
  if (D > 0) factors.push({ label: "Inside or near Active Danger Zone", value: D, weight: weights.dangerZone });

  // 5. Road Risk Factor (R)
  let R = roadStatus === "blocked" ? 1.0 : roadStatus === "at_risk" ? 0.5 : 0.0;
  if (R > 0) factors.push({ label: `Road status: ${roadStatus}`, value: R, weight: weights.road });

  // 6. Route Context Risk Factor (C)
  let C = priority === "critical" ? 0.8 : priority === "high" ? 0.5 : 0.2;
  if (isMovingBeforeLoss) C += 0.2;
  C = Math.min(1.0, C);
  factors.push({ label: "Route priority & pre-loss motion", value: C, weight: weights.routeContext });

  // Mathematical Risk Formula:
  // Final Risk = [ (I * w1) + (W * w2) + (H * w3) + (D * w4) + (R * w5) + (C * w6) ] * 100
  const totalWeightedScore =
    (I * weights.inactivity) +
    (W * weights.weather) +
    (H * weights.hazard) +
    (D * weights.dangerZone) +
    (R * weights.road) +
    (C * weights.routeContext);

  const finalRiskScore = Math.min(100, Math.max(0, Math.round(totalWeightedScore * 100)));

  // Classify Status
  let alertLevel = "COMMUNICATION_LOST";
  let status = "COMMUNICATION_LOST";

  if (offlineDurationMinutes < 3) {
    alertLevel = "ACTIVE";
    status = "MONITORING";
  } else if (offlineDurationMinutes < 5) {
    alertLevel = "CONNECTION_WEAK";
    status = "CONNECTION_WEAK";
  } else if (offlineDurationMinutes < 10) {
    alertLevel = "NOT_RESPONDING";
    status = "NOT_RESPONDING";
  } else {
    // > 10 Minutes Offline Threshold Exceeded
    if (finalRiskScore >= 65 || D === 1.0 || W >= 0.7) {
      alertLevel = "HIGH_RISK_INCIDENT";
      status = "POSSIBLE_INCIDENT";
    } else if (finalRiskScore >= 40 || isMovingBeforeLoss || H > 0) {
      alertLevel = "POSSIBLE_INCIDENT";
      status = "POSSIBLE_INCIDENT";
    } else {
      alertLevel = "COMMUNICATION_LOST";
      status = "COMMUNICATION_LOST";
    }
  }

  return {
    inactivityFactor: I,
    weatherRisk: W,
    hazardRisk: H,
    dangerZoneRisk: D,
    roadRisk: R,
    routeContextRisk: C,
    finalRiskScore,
    alertLevel,
    status,
    factors,
  };
}

/**
 * Creates or updates a driver inactivity connectivity alert in Supabase database
 */
export async function createInactivityAlert(alertPayload) {
  try {
    const dbData = {
      driver_id: alertPayload.driverId || null,
      driver_name: alertPayload.driverName || "Driver",
      driver_phone: alertPayload.driverPhone || null,
      vehicle_id: alertPayload.vehicleId || null,
      vehicle_no: alertPayload.vehicleNo || "N/A",
      company_id: alertPayload.companyId || null,
      company_name: alertPayload.companyName || "ORION Logistics",
      shipment_id: alertPayload.shipmentId || null,
      route_id: alertPayload.routeId || null,
      last_ping_at: alertPayload.lastPingAt || new Date().toISOString(),
      offline_started_at: alertPayload.offlineStartedAt || new Date().toISOString(),
      offline_duration_minutes: alertPayload.offlineDurationMinutes || 10,
      latitude: alertPayload.latitude || null,
      longitude: alertPayload.longitude || null,
      location_accuracy: alertPayload.locationAccuracy || null,
      last_speed_kmh: alertPayload.lastSpeedKmh || 0,
      weather_risk: alertPayload.weatherRisk || 0,
      hazard_risk: alertPayload.hazardRisk || 0,
      danger_zone_risk: alertPayload.dangerZoneRisk || 0,
      road_risk: alertPayload.roadRisk || 0,
      inactivity_risk: alertPayload.inactivityRisk || 0,
      final_risk_score: alertPayload.finalRiskScore || 50,
      alert_level: alertPayload.alertLevel || "COMMUNICATION_LOST",
      status: alertPayload.status || "COMMUNICATION_LOST",
      created_at: new Date().toISOString(),
    };

    // Remove existing memory entry for same driver to prevent duplicates
    memoryInactivityAlerts = memoryInactivityAlerts.filter(
      (a) => a.driver_name !== dbData.driver_name && a.driver_id !== dbData.driver_id
    );

    const { data, error } = await supabase.from("driver_connectivity_alerts").insert(dbData).select().single();

    if (error) {
      console.warn("[inactivityService] Supabase insert failed, using memory fallback:", error.message);
      const fallbackItem = { ...dbData, id: `MEM_ALERT_${Date.now()}` };
      memoryInactivityAlerts.unshift(fallbackItem);
      return fallbackItem;
    }
    return data;
  } catch (err) {
    console.warn("[inactivityService] Exception in createInactivityAlert:", err.message);
    const fallbackItem = { ...alertPayload, id: `MEM_ALERT_${Date.now()}` };
    memoryInactivityAlerts.unshift(fallbackItem);
    return fallbackItem;
  }
}

/**
 * Automatically resolves active inactivity alerts when driver reconnects and sends a heartbeat ping
 */
const cleanStr = (s) => (s ? s.toString().trim().toLowerCase() : "");

export async function resolveAlertOnDriverReconnect(driverId, driverName) {
  try {
    const targetName = cleanStr(driverName);
    const targetId = cleanStr(driverId);

    // Clear from memory fallback using robust case-insensitive comparison
    memoryInactivityAlerts = memoryInactivityAlerts.filter((a) => {
      const matchId = targetId && cleanStr(a.driver_id) === targetId;
      const matchName = targetName && cleanStr(a.driver_name) === targetName;
      return !(matchId || matchName);
    });

    // Update Supabase table if active alerts exist for driver
    const updateData = {
      status: "RESOLVED",
      resolution_notes: "Driver reconnected and sent active heartbeat ping",
      resolved_at: new Date().toISOString(),
    };

    if (driverId) {
      await supabase
        .from("driver_connectivity_alerts")
        .update(updateData)
        .eq("driver_id", driverId)
        .in("status", ["COMMUNICATION_LOST", "CONNECTION_WEAK", "NOT_RESPONDING", "POSSIBLE_INCIDENT"]);
    }
    if (driverName) {
      await supabase
        .from("driver_connectivity_alerts")
        .update(updateData)
        .ilike("driver_name", driverName.trim())
        .in("status", ["COMMUNICATION_LOST", "CONNECTION_WEAK", "NOT_RESPONDING", "POSSIBLE_INCIDENT"]);
    }
  } catch (err) {
    console.warn("[inactivityService] Auto-resolve on driver reconnect failed:", err);
  }
}

/**
 * List all driver inactivity connectivity alerts (Deduplicated by driver)
 */
export async function listInactivityAlerts() {
  try {
    const { data, error } = await supabase
      .from("driver_connectivity_alerts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return deduplicateDriverAlerts(memoryInactivityAlerts);
    }
    return deduplicateDriverAlerts(data || memoryInactivityAlerts);
  } catch {
    return deduplicateDriverAlerts(memoryInactivityAlerts);
  }
}

/**
 * Update alert investigation status (UNDER_INVESTIGATION, CONFIRMED_INCIDENT, FALSE_ALARM, RESOLVED)
 */
export async function updateInactivityAlertStatus(alertId, newStatus, adminId = null, resolutionNotes = "") {
  try {
    const updatePayload = {
      status: newStatus,
      resolution_notes: resolutionNotes,
    };

    if (newStatus === "RESOLVED" || newStatus === "CONFIRMED_INCIDENT" || newStatus === "FALSE_ALARM") {
      updatePayload.resolved_at = new Date().toISOString();
      updatePayload.resolved_by = adminId;
    } else if (newStatus === "UNDER_INVESTIGATION") {
      updatePayload.acknowledged_at = new Date().toISOString();
      updatePayload.acknowledged_by = adminId;
    }

    const { data, error } = await supabase
      .from("driver_connectivity_alerts")
      .update(updatePayload)
      .eq("id", alertId)
      .select()
      .single();

    if (error) {
      memoryInactivityAlerts = memoryInactivityAlerts.map((a) =>
        a.id === alertId ? { ...a, ...updatePayload } : a
      );
      return { id: alertId, status: newStatus };
    }
    return data;
  } catch {
    memoryInactivityAlerts = memoryInactivityAlerts.map((a) =>
      a.id === alertId ? { ...a, status: newStatus } : a
    );
    return { id: alertId, status: newStatus };
  }
}
