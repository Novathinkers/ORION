// ============================================================================
// ORION MODULAR EMERGENCY COMMUNICATION SERVICE (`emergencyCommunicationService.js`)
// ----------------------------------------------------------------------------
// Implements emergency communication provider abstraction:
//   1. InternetProvider (Supabase Realtime & Postgres API)
//   2. SatelliteProvider (Compact satellite emergency burst protocol interface)
//   3. SMSProvider (Emergency SMS Gateway interface)
//   4. OfflineQueueProvider (IndexedDB / LocalStorage offline queue fallback)
// ============================================================================

import { supabase } from "./supabaseClient";

const OFFLINE_SOS_QUEUE_KEY = "orion_sos_offline_queue_v1";

/**
 * Standardized Provider Result Schema
 * {
 *   success: boolean,
 *   provider: "internet" | "satellite" | "sms" | "offline_queue",
 *   messageId: string,
 *   timestamp: string,
 *   status: string,
 *   error?: string,
 *   rawPayload?: string
 * }
 */

// Helper to read local offline queue
export function readOfflineSosQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_SOS_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

// Helper to write local offline queue
export function writeOfflineSosQueue(items) {
  localStorage.setItem(OFFLINE_SOS_QUEUE_KEY, JSON.stringify(items));
}

// --- 1. INTERNET PROVIDER ---
export const InternetProvider = {
  name: "internet",
  async sendViaInternet(sosPayload) {
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return {
          success: false,
          provider: "internet",
          error: "Internet connection unavailable",
        };
      }

      const dbData = {
        driver_id: sosPayload.driverId || null,
        driver_name: sosPayload.driverName || "Driver",
        driver_phone: sosPayload.driverPhone || null,
        vehicle_id: sosPayload.vehicleId || null,
        vehicle_no: sosPayload.vehicleNo || "N/A",
        company_id: sosPayload.companyId || null,
        company_name: sosPayload.companyName || "ORION Logistics",
        shipment_id: sosPayload.shipmentId || null,
        route_id: sosPayload.routeId || null,
        emergency_type: sosPayload.emergencyType || "Other Emergency",
        message: sosPayload.message || "Emergency alert triggered",
        latitude: sosPayload.latitude || null,
        longitude: sosPayload.longitude || null,
        location_accuracy: sosPayload.locationAccuracy || null,
        location_timestamp: sosPayload.locationTimestamp || new Date().toISOString(),
        network_status: "online",
        communication_provider: "internet",
        status: "DELIVERED",
        sent_at: new Date().toISOString(),
        retry_count: sosPayload.retryCount || 0,
      };

      const { data, error } = await supabase.from("sos_alerts").insert(dbData).select().single();

      if (error) {
        console.warn("[InternetProvider] Supabase insert failed:", error.message);
        return {
          success: false,
          provider: "internet",
          error: error.message,
        };
      }

      return {
        success: true,
        provider: "internet",
        messageId: data.id,
        timestamp: data.created_at || new Date().toISOString(),
        status: "DELIVERED",
        record: data,
      };
    } catch (err) {
      return {
        success: false,
        provider: "internet",
        error: err.message || "Network request failed",
      };
    }
  },
};

// --- 2. SATELLITE PROVIDER (Compact Low-Bandwidth Burst Protocol) ---
export const SatelliteProvider = {
  name: "satellite",
  isConfigured() {
    return (
      (typeof window !== "undefined" && window.satelliteTransceiver) ||
      (import.meta.env && import.meta.env.VITE_SATELLITE_API_URL)
    );
  },
  formatCompactPayload(sosPayload) {
    // Format compact 120-character Satellite SOS payload
    const driverShort = (sosPayload.driverName || "Driver").split(" ")[0];
    const vehShort = (sosPayload.vehicleNo || "N/A").replace(/[\s-]/g, "");
    const typeShort = (sosPayload.emergencyType || "EMERGENCY").toUpperCase().replace(/\s+/g, "_");
    const lat = sosPayload.latitude ? Number(sosPayload.latitude).toFixed(4) : "0.0000";
    const lng = sosPayload.longitude ? Number(sosPayload.longitude).toFixed(4) : "0.0000";
    const timeStr = new Date(sosPayload.timestamp || Date.now()).toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit" });

    return `ORION SOS | Driver: ${driverShort} | Veh: ${vehShort} | Type: ${typeShort} | GPS: ${lat},${lng} | Time: ${timeStr} | Status: OFFLINE`;
  },
  async sendViaSatellite(sosPayload) {
    const compactMessage = this.formatCompactPayload(sosPayload);

    if (!this.isConfigured()) {
      return {
        success: false,
        provider: "satellite",
        error: "Satellite communication is not configured or hardware transceiver unavailable.",
        rawPayload: compactMessage,
      };
    }

    try {
      // If hardware interface exists (e.g. Capacitor Satellite plugin or Satellite Transceiver Web Gateway)
      if (typeof window !== "undefined" && window.satelliteTransceiver?.transmit) {
        const res = await window.satelliteTransceiver.transmit({ payload: compactMessage });
        return {
          success: true,
          provider: "satellite",
          messageId: res.messageId || `SAT_${Date.now()}`,
          timestamp: new Date().toISOString(),
          status: "SENT_VIA_SATELLITE",
          rawPayload: compactMessage,
        };
      }

      return {
        success: false,
        provider: "satellite",
        error: "Satellite hardware interface unready.",
        rawPayload: compactMessage,
      };
    } catch (err) {
      return {
        success: false,
        provider: "satellite",
        error: err.message || "Satellite transmission failed.",
        rawPayload: compactMessage,
      };
    }
  },
};

// --- 3. SMS PROVIDER (Emergency SMS Gateway Interface) ---
export const SMSProvider = {
  name: "sms",
  formatSmsPayload(sosPayload) {
    const type = (sosPayload.emergencyType || "EMERGENCY").toUpperCase();
    const lat = sosPayload.latitude ? Number(sosPayload.latitude).toFixed(4) : "0.0000";
    const lng = sosPayload.longitude ? Number(sosPayload.longitude).toFixed(4) : "0.0000";
    return `ORION EMERGENCY SOS: Driver ${sosPayload.driverName || "Driver"} (${sosPayload.driverPhone || "No Phone"}), Vehicle ${sosPayload.vehicleNo || "N/A"}. Type: ${type}. Location: ${lat},${lng}. Time: ${new Date().toLocaleTimeString()}`;
  },
  async sendViaSMS(sosPayload) {
    const smsMessage = this.formatSmsPayload(sosPayload);
    // Web browsers cannot silently send background SMS without SMS Gateway or Native App wrapper
    return {
      success: false,
      provider: "sms",
      error: "SMS gateway is not configured or unavailable.",
      rawPayload: smsMessage,
    };
  },
};

// --- 4. OFFLINE QUEUE PROVIDER ---
export const OfflineQueueProvider = {
  name: "offline_queue",
  saveToOfflineQueue(sosPayload) {
    const queue = readOfflineSosQueue();
    const id = sosPayload.id || `SOS_QUEUED_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    const queuedItem = {
      ...sosPayload,
      id,
      network_status: "offline",
      communication_provider: "offline_queue",
      status: "OFFLINE_QUEUED",
      created_at: sosPayload.timestamp || new Date().toISOString(),
      queued_at: new Date().toISOString(),
      retry_count: (sosPayload.retry_count || 0) + 1,
    };

    // Avoid duplicate queue entries
    const existingIdx = queue.findIndex((item) => item.id === id);
    if (existingIdx >= 0) {
      queue[existingIdx] = queuedItem;
    } else {
      queue.push(queuedItem);
    }

    writeOfflineSosQueue(queue);

    return {
      success: true,
      provider: "offline_queue",
      messageId: id,
      timestamp: queuedItem.created_at,
      status: "OFFLINE_QUEUED",
      record: queuedItem,
    };
  },
};

// --- EMERGENCY COMMUNICATION SERVICE DISPATCHER ---
export const EmergencyCommunicationService = {
  async dispatchSOS(sosPayload) {
    const isOnline = typeof navigator !== "undefined" && navigator.onLine;

    // 1. ONLINE PATH: Try Internet -> Supabase -> Admin Dashboard
    if (isOnline) {
      const internetResult = await InternetProvider.sendViaInternet(sosPayload);
      if (internetResult.success) {
        return internetResult;
      }
    }

    // 2. OFFLINE PATH: Try Satellite -> SMS -> Offline Queue
    const satelliteResult = await SatelliteProvider.sendViaSatellite(sosPayload);
    if (satelliteResult.success) {
      return satelliteResult;
    }

    const smsResult = await SMSProvider.sendViaSMS(sosPayload);
    if (smsResult.success) {
      return smsResult;
    }

    // 3. FALLBACK: Secure local offline queue
    const queueResult = OfflineQueueProvider.saveToOfflineQueue(sosPayload);
    return queueResult;
  },
};
