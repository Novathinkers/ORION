import { supabase } from "./supabaseClient";

// ============================================================================
// Centralized data-access layer. Pages call these functions instead of
// talking to `supabase` directly, so query shape/RLS assumptions live in one
// place and are easy to audit or swap out.
// ============================================================================

// ---- Organizations / Users ----

export async function getOrganization(orgId) {
  const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId).single();
  if (error) throw error;
  return data;
}

export async function listOrgDrivers(orgId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("organization_id", orgId)
    .eq("role", "secondary")
    .order("full_name");
  if (error) throw error;
  return data;
}

export async function listAllProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*, organizations(name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function setUserStatus(userId, status) {
  const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
  if (error) throw error;
}

export async function setUserPhoto(userId, photoUrl) {
  const { error } = await supabase.from("profiles").update({ photo_url: photoUrl }).eq("id", userId);
  if (error) throw error;
}

export async function listAllOrganizations() {
  const { data, error } = await supabase.from("organizations").select("*").order("name");
  if (error) throw error;
  return data;
}

// ---- Vehicles ----

export async function listOrgVehicles(orgId) {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("organization_id", orgId)
    .order("registration_no");
  if (error) throw error;
  return data;
}

export async function createVehicle({ organizationId, registrationNo, vehicleType, capacityKg }) {
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      organization_id: organizationId,
      registration_no: registrationNo,
      vehicle_type: vehicleType,
      capacity_kg: capacityKg,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setVehicleStatus(vehicleId, status) {
  const { error } = await supabase.from("vehicles").update({ status }).eq("id", vehicleId);
  if (error) throw error;
}

// ---- Shipments ----

const SHIPMENT_SELECT = `
  *,
  driver:profiles!shipments_driver_id_fkey(id, full_name, phone, created_at, status),
  vehicle:vehicles(id, registration_no, vehicle_type),
  organization:organizations(id, name)
`;

export async function listOrgShipments(orgId) {
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_SELECT)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listDriverShipments(driverId) {
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_SELECT)
    .eq("driver_id", driverId)
    .in("status", ["assigned", "ready_to_start", "in_transit", "delayed", "rerouting", "arrived"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listAllShipments() {
  const { data, error } = await supabase
    .from("shipments")
    .select(SHIPMENT_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getShipment(id) {
  const { data, error } = await supabase.from("shipments").select(SHIPMENT_SELECT).eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createShipment(payload) {
  const { data, error } = await supabase.from("shipments").insert(payload).select(SHIPMENT_SELECT).single();
  if (error) throw error;
  return data;
}

export async function updateShipment(id, patch) {
  const { data, error } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", id)
    .select(SHIPMENT_SELECT)
    .single();
  if (error) throw error;
  return data;
}

// ---- GPS ----

export async function insertGpsPoint({ shipmentId, driverId, lat, lng, speedKmh, heading, accuracyM, source = "real" }) {
  const { error } = await supabase.from("gps_locations").insert({
    shipment_id: shipmentId,
    driver_id: driverId,
    lat,
    lng,
    speed_kmh: speedKmh,
    heading,
    accuracy_m: accuracyM,
    source,
  });
  if (error) throw error;
}

export async function getLatestGpsForShipment(shipmentId) {
  const { data, error } = await supabase
    .from("gps_locations")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLatestGpsForActiveShipments(shipmentIds) {
  if (!shipmentIds.length) return {};
  const { data, error } = await supabase
    .from("gps_locations")
    .select("*")
    .in("shipment_id", shipmentIds)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  const latestByShipment = {};
  for (const row of data) {
    if (!latestByShipment[row.shipment_id]) latestByShipment[row.shipment_id] = row;
  }
  return latestByShipment;
}

// ---- Weather / Road / Incidents ----

export async function getLatestWeather() {
  const { data, error } = await supabase
    .from("weather_conditions")
    .select("*")
    .order("recorded_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data;
}

export async function getActiveRoadIssues() {
  const { data, error } = await supabase
    .from("road_conditions")
    .select("*")
    .neq("status", "open")
    .order("recorded_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function getActiveIncidents() {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).filter((i) => i.status === "active" || i.is_danger_zone === true);
}

// ---- Alerts ----

export async function listOrgAlerts(orgId) {
  const { data, error } = await supabase
    .from("alerts")
    .select("*, shipments(source_name, destination_name, priority)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function listAllAlerts() {
  const { data, error } = await supabase
    .from("alerts")
    .select("*, shipments(source_name, destination_name, priority), organizations(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export async function acknowledgeAlert(alertId, userId) {
  const { error } = await supabase
    .from("alerts")
    .update({ acknowledged: true, acknowledged_by: userId })
    .eq("id", alertId);
  if (error) throw error;
}

// ---- Risk history ----

export async function insertRiskHistory({ shipmentId, score, factors, explanation }) {
  const { error } = await supabase.from("risk_score_history").insert({
    shipment_id: shipmentId,
    score,
    factors_json: factors,
    explanation,
  });
  if (error) throw error;
}

export async function getRiskHistory(shipmentId) {
  const { data, error } = await supabase
    .from("risk_score_history")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return data;
}

// ---- Hazard reports / danger zones (image-analyzed incidents) ----

const LOCAL_STORAGE_INCIDENTS_KEY = "orion_cloud_incidents_v2";

function getLocalSavedIncidents() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_INCIDENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalIncident(incident) {
  try {
    const existing = getLocalSavedIncidents();
    const updated = [incident, ...existing.filter((i) => i.id !== incident.id)];
    localStorage.setItem(LOCAL_STORAGE_INCIDENTS_KEY, JSON.stringify(updated));
  } catch {
    // Storage quota fallback
  }
}

/** Driver/field submission: photo + optional voice + AI classification, awaiting admin review. */
export async function reportHazard({ reportedBy, lat, lng, imageUrl, voiceUrl, aiAnalysis }) {
  const incidentId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `inc_${Date.now()}`;
  const fullPayload = {
    id: incidentId,
    type: aiAnalysis?.category || "unclear",
    description: aiAnalysis?.driver_description || aiAnalysis?.explanation || aiAnalysis?.description || null,
    lat,
    lng,
    severity: (aiAnalysis?.severity || "moderate").toLowerCase(),
    source: "real",
    status: "pending_review",
    reported_by: reportedBy,
    image_url: imageUrl,
    voice_url: voiceUrl || null,
    ai_analysis: aiAnalysis,
    created_at: new Date().toISOString(),
  };

  // Permanently save locally
  saveLocalIncident(fullPayload);

  try {
    const { data, error } = await supabase
      .from("incidents")
      .insert(fullPayload)
      .select()
      .single();
    if (!error && data) {
      saveLocalIncident(data);
      return data;
    }
  } catch {
    try {
      const basePayload = {
        id: incidentId,
        type: aiAnalysis?.category || "unclear",
        description: aiAnalysis?.explanation || aiAnalysis?.description || null,
        lat,
        lng,
        severity: (aiAnalysis?.severity || "moderate").toLowerCase(),
        source: "real",
        status: "pending_review",
        reported_by: reportedBy,
      };
      await supabase.from("incidents").insert(basePayload);
    } catch {
      // fallback
    }
  }

  return fullPayload;
}

const localIncidentOverrides = {};

export async function listAllHazardReports({ role = "admin", userId, orgId } = {}) {
  let dbResults = [];
  try {
    let query = supabase
      .from("incidents")
      .select("*, reporter:profiles!incidents_reported_by_fkey(id, full_name, phone, photo_url, organization_id)")
      .order("created_at", { ascending: false });

    if (role === "secondary" && userId) {
      query = query.eq("reported_by", userId);
    }

    const { data, error } = await query;
    if (!error && data) dbResults = data;
  } catch {
    const { data } = await supabase.from("incidents").select("*").order("created_at", { ascending: false });
    if (data) dbResults = data;
  }

  const localSaved = getLocalSavedIncidents();
  const mergedMap = new Map();

  // 1. Add DB results
  dbResults.forEach((item) => mergedMap.set(item.id, item));

  // 2. Merge local saved items so custom driver submissions are never lost
  localSaved.forEach((item) => {
    if (!mergedMap.has(item.id)) {
      mergedMap.set(item.id, item);
    } else {
      mergedMap.set(item.id, { ...mergedMap.get(item.id), ...item });
    }
  });

  let results = Array.from(mergedMap.values());

  if (role === "secondary" && userId) {
    results = results.filter((r) => r.reported_by === userId);
  } else if (role === "primary" && orgId) {
    results = results.filter((r) => r.reporter?.organization_id === orgId || r.reported_by === userId);
  }

  // Merge in-memory status overrides & sort
  return results
    .map((r) => (localIncidentOverrides[r.id] ? { ...r, ...localIncidentOverrides[r.id] } : r))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export async function listPendingHazardReports() {
  const all = await listAllHazardReports();
  return all.filter((i) => i.status === "pending_review");
}

export async function listActiveDangerZones() {
  const all = await listAllHazardReports();
  return all.filter((i) => i.status === "active" || i.status === "blocked" || i.is_danger_zone);
}

/** Admin confirms a pending report as an active danger zone. */
export async function markDangerZone(incidentId, { radiusKm = 5, reviewedBy }) {
  const patch = { status: "active", is_danger_zone: true, radius_km: radiusKm, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
  localIncidentOverrides[incidentId] = patch;

  const localSaved = getLocalSavedIncidents();
  const target = localSaved.find((i) => i.id === incidentId);
  if (target) saveLocalIncident({ ...target, ...patch });

  try {
    const { data, error } = await supabase
      .from("incidents")
      .update({
        is_danger_zone: true,
        status: "active",
        radius_km: radiusKm,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", incidentId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[markDangerZone] Supabase select warning, running direct update:", error.message);
      await supabase
        .from("incidents")
        .update({ status: "active", is_danger_zone: true, radius_km: radiusKm })
        .eq("id", incidentId);
    } else if (data) {
      saveLocalIncident(data);
      return data;
    }
  } catch (err) {
    console.error("[markDangerZone] Supabase DB error:", err.message);
  }
  return { id: incidentId, ...patch };
}

/**
 * ADMIN CONFIRMATION: MARK ROAD AS BLOCKED
 */
export async function markRoadBlocked(incidentId, { radiusKm = 5, reviewedBy, roadSegment = "Highway Segment" }) {
  const patch = { status: "blocked", is_danger_zone: true, radius_km: radiusKm, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
  localIncidentOverrides[incidentId] = patch;

  const localSaved = getLocalSavedIncidents();
  const target = localSaved.find((i) => i.id === incidentId);
  if (target) saveLocalIncident({ ...target, ...patch });

  let updatedIncident = { id: incidentId, ...patch, lat: 26.1445, lng: 91.7362 };

  try {
    const { data, error } = await supabase
      .from("incidents")
      .update({
        is_danger_zone: true,
        status: "blocked",
        radius_km: radiusKm,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", incidentId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[markRoadBlocked] Supabase select warning, running direct update:", error.message);
      await supabase
        .from("incidents")
        .update({ status: "blocked", is_danger_zone: true, radius_km: radiusKm })
        .eq("id", incidentId);
    } else if (data) {
      updatedIncident = data;
      saveLocalIncident(data);
    }
  } catch (err) {
    console.error("[markRoadBlocked] Supabase DB error:", err.message);
  }

  // 3. Store in road_conditions table in Supabase
  try {
    await supabase.from("road_conditions").insert({
      road_segment: roadSegment,
      lat: updatedIncident.lat,
      lng: updatedIncident.lng,
      status: "blocked",
      reason: updatedIncident.description || "Admin confirmed road blockage",
      source: "real",
    });
  } catch (err) {
    console.warn("[markRoadBlocked] road_conditions insert warning:", err.message);
  }

  return updatedIncident;
}

export async function dismissHazardReport(incidentId, reviewedBy) {
  const patch = { status: "dismissed", is_danger_zone: false, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
  localIncidentOverrides[incidentId] = patch;

  const localSaved = getLocalSavedIncidents();
  const target = localSaved.find((i) => i.id === incidentId);
  if (target) saveLocalIncident({ ...target, ...patch });

  try {
    const { data, error } = await supabase
      .from("incidents")
      .update({ status: "dismissed", reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", incidentId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[dismissHazardReport] Supabase select warning, running direct update:", error.message);
      await supabase.from("incidents").update({ status: "dismissed" }).eq("id", incidentId);
    } else if (data) {
      saveLocalIncident(data);
      return data;
    }
  } catch (err) {
    console.error("[dismissHazardReport] Supabase DB error:", err.message);
  }

  return { id: incidentId, ...patch };
}

/** Admin deletes / unblocks a blocked road hazard. */
export async function deleteRoadBlock(incidentId, reviewedBy) {
  const patch = { status: "dismissed", is_danger_zone: false, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
  localIncidentOverrides[incidentId] = patch;

  const localSaved = getLocalSavedIncidents();
  const target = localSaved.find((i) => i.id === incidentId);
  if (target) saveLocalIncident({ ...target, ...patch });

  try {
    const { data } = await supabase
      .from("incidents")
      .update({ status: "dismissed", is_danger_zone: false, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", incidentId)
      .select()
      .maybeSingle();

    await supabase.from("road_conditions").delete().eq("status", "blocked");

    if (data) saveLocalIncident(data);
    return data || { id: incidentId, ...patch };
  } catch (err) {
    console.error("[deleteRoadBlock] Error:", err.message);
    return { id: incidentId, ...patch };
  }
}

// ---- Manager Scope Isolation & Hierarchy ----

export async function listManagerDrivers(managerId, orgId) {
  if (!orgId) return [];
  let query = supabase
    .from("profiles")
    .select("*")
    .eq("organization_id", orgId)
    .eq("role", "secondary");
  
  if (managerId) {
    // Return drivers assigned to this specific manager or org scope
    query = query.or(`primary_user_id.eq.${managerId},primary_user_id.is.null`);
  }

  const { data, error } = await query.order("full_name");
  if (error) throw error;
  return data || [];
}

export async function listCompanyHierarchy() {
  const [companies, profiles, vehicles, shipments] = await Promise.all([
    listAllOrganizations().catch(() => []),
    listAllProfiles().catch(() => []),
    supabase.from("vehicles").select("*").catch(() => ({ data: [] })),
    listAllShipments().catch(() => []),
  ]);

  const managers = profiles.filter((p) => p.role === "primary");
  const drivers = profiles.filter((p) => p.role === "secondary");

  return companies.map((c) => {
    const companyManagers = managers.filter((m) => m.organization_id === c.id);
    const companyDrivers = drivers.filter((d) => d.organization_id === c.id);
    const companyVehicles = (vehicles.data || []).filter((v) => v.organization_id === c.id);
    const companyShipments = shipments.filter((s) => s.organization_id === c.id);

    return {
      ...c,
      managers: companyManagers,
      drivers: companyDrivers,
      vehicles: companyVehicles,
      shipments: companyShipments,
    };
  });
}

// ---- Call logs ----

export async function listCallLogsForShipment(shipmentId) {
  try {
    const { data, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

export async function updateUserProfile(userId, { fullName, phone, photoUrl }) {
  const updates = {};
  if (fullName !== undefined) updates.full_name = fullName;
  if (phone !== undefined) updates.phone = phone;
  if (photoUrl !== undefined) updates.photo_url = photoUrl;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[updateUserProfile] Supabase update warning:", error.message);
      // Fallback: update without .select()
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId);
      if (fallbackErr) throw fallbackErr;
      return fallbackData;
    }
    return data;
  } catch (err) {
    console.error("[updateUserProfile] Supabase database update error:", err.message);
    throw new Error(err.message || "Failed to update profile row in Supabase");
  }
}

// ---- Navigation Users (Public / Guest Navigation SQL DB) ----

export async function saveNavigationUser({ name, phone, lat = null, lng = null }) {
  if (!name || !phone) return null;
  try {
    const { data, error } = await supabase
      .from("navigation_users")
      .upsert(
        {
          name: name.trim(),
          phone: phone.trim(),
          last_known_lat: lat,
          last_known_lng: lng,
          last_active_at: new Date().toISOString(),
        },
        { onConflict: "phone" }
      )
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[saveNavigationUser] Supabase upsert warning:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("Failed to save navigation user to database:", err);
    return null;
  }
}

export async function listNavigationUsers() {
  try {
    const { data, error } = await supabase
      .from("navigation_users")
      .select("*")
      .order("last_active_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Failed to fetch navigation users:", err);
    return [];
  }
}

