// ============================================================================
// ORION SOS SERVICE (`sosService.js`)
// ----------------------------------------------------------------------------
// Centralized data service for SOS Emergency Alerts with Supabase integration,
// realtime subscriptions, and robust local offline queue sync.
// ============================================================================

import { supabase } from "./supabaseClient";
import { readOfflineSosQueue, writeOfflineSosQueue, EmergencyCommunicationService } from "./emergencyCommunicationService";

// In-memory fallback list if Supabase database table is unpopulated
let localSosMemoryList = [];

export async function createSosAlert(sosPayload) {
  const result = await EmergencyCommunicationService.dispatchSOS(sosPayload);
  return result;
}

export async function listSosAlerts() {
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[sosService] List alerts failed, using memory/queue fallback:", error.message);
      return readOfflineSosQueue().concat(localSosMemoryList);
    }
    return data || [];
  } catch {
    return readOfflineSosQueue().concat(localSosMemoryList);
  }
}

export async function listActiveSosAlerts() {
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select("*")
      .in("status", ["ACTIVE", "ACKNOWLEDGED", "OFFLINE_QUEUED", "CREATED"])
      .order("created_at", { ascending: false });

    if (error) {
      return readOfflineSosQueue().concat(localSosMemoryList).filter((a) => ["ACTIVE", "ACKNOWLEDGED", "OFFLINE_QUEUED", "CREATED"].includes(a.status));
    }
    return data || [];
  } catch {
    return readOfflineSosQueue().concat(localSosMemoryList).filter((a) => ["ACTIVE", "ACKNOWLEDGED", "OFFLINE_QUEUED", "CREATED"].includes(a.status));
  }
}

export async function acknowledgeSosAlert(alertId, adminId = null) {
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .update({
        status: "ACKNOWLEDGED",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: adminId,
      })
      .eq("id", alertId)
      .select()
      .single();

    if (error) {
      // Memory fallback update
      localSosMemoryList = localSosMemoryList.map((a) =>
        a.id === alertId ? { ...a, status: "ACKNOWLEDGED", acknowledged_at: new Date().toISOString() } : a
      );
      return { id: alertId, status: "ACKNOWLEDGED" };
    }
    return data;
  } catch {
    localSosMemoryList = localSosMemoryList.map((a) =>
      a.id === alertId ? { ...a, status: "ACKNOWLEDGED", acknowledged_at: new Date().toISOString() } : a
    );
    return { id: alertId, status: "ACKNOWLEDGED" };
  }
}

export async function resolveSosAlert(alertId, adminId = null, resolutionNotes = "") {
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .update({
        status: "RESOLVED",
        resolved_at: new Date().toISOString(),
        resolved_by: adminId,
        resolution_notes: resolutionNotes,
      })
      .eq("id", alertId)
      .select()
      .single();

    if (error) {
      localSosMemoryList = localSosMemoryList.map((a) =>
        a.id === alertId ? { ...a, status: "RESOLVED", resolved_at: new Date().toISOString(), resolution_notes: resolutionNotes } : a
      );
      return { id: alertId, status: "RESOLVED" };
    }
    return data;
  } catch {
    localSosMemoryList = localSosMemoryList.map((a) =>
      a.id === alertId ? { ...a, status: "RESOLVED", resolved_at: new Date().toISOString(), resolution_notes: resolutionNotes } : a
    );
    return { id: alertId, status: "RESOLVED" };
  }
}

/**
 * Flush and sync all queued offline SOS alerts when internet connectivity is restored.
 * IMPORTANT TECHNICAL RULE: Never delete an item from the queue until delivery to server is confirmed!
 */
export async function syncQueuedSosAlerts() {
  const queue = readOfflineSosQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, remainingCount: 0 };
  }

  let syncedCount = 0;
  const remainingQueue = [...queue];

  while (remainingQueue.length > 0) {
    const item = remainingQueue[0];
    try {
      const dbData = {
        driver_id: item.driverId || null,
        driver_name: item.driverName || "Driver",
        driver_phone: item.driverPhone || null,
        vehicle_id: item.vehicleId || null,
        vehicle_no: item.vehicleNo || "N/A",
        company_id: item.companyId || null,
        company_name: item.companyName || "ORION Logistics",
        shipment_id: item.shipmentId || null,
        route_id: item.routeId || null,
        emergency_type: item.emergencyType || "Other Emergency",
        message: item.message || "Offline emergency alert synced upon connection restoration",
        latitude: item.latitude || null,
        longitude: item.longitude || null,
        location_accuracy: item.locationAccuracy || null,
        location_timestamp: item.locationTimestamp || item.created_at || new Date().toISOString(),
        network_status: "restored",
        communication_provider: "offline_sync",
        status: "DELIVERED",
        sent_at: new Date().toISOString(),
        retry_count: (item.retry_count || 0) + 1,
      };

      const { data, error } = await supabase.from("sos_alerts").insert(dbData).select().single();

      if (!error && data) {
        // Delivery confirmed! Remove from offline queue
        remainingQueue.shift();
        writeOfflineSosQueue(remainingQueue);
        syncedCount++;
      } else {
        // Delivery failed, keep remaining items in queue for next retry
        break;
      }
    } catch (err) {
      console.warn("[sosService] Sync failed for queued SOS item:", item.id, err.message);
      break;
    }
  }

  return { syncedCount, remainingCount: remainingQueue.length };
}
