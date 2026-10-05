import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGeolocation } from "./useGeolocation";
import { supabase } from "../lib/supabaseClient";
import { createInactivityAlert, evaluateInactivityRisk, resolveAlertOnDriverReconnect } from "../lib/inactivityService";

const HEARTBEAT_INTERVAL_MS = 35000; // Send heartbeat ping every 35 seconds
const LAST_PING_KEY = "orion_driver_last_ping_v1";

export function useDriverHeartbeat({ shipment = null, activeDangerZones = [] } = {}) {
  const { user, profile } = useAuth();
  const geo = useGeolocation();
  const heartbeatTimerRef = useRef(null);

  const sendHeartbeat = useCallback(async () => {
    if (!user) return;

    const lat = geo.position?.lat || null;
    const lng = geo.position?.lng || null;
    const speed = geo.position?.speedKmh != null ? geo.position.speedKmh : 0;
    const accuracy = geo.position?.accuracyM || null;
    const nowIso = new Date().toISOString();

    const pingPayload = {
      driverId: user.id || profile?.id,
      driverName: profile?.full_name || user.email?.split("@")[0] || "Driver",
      driverPhone: profile?.phone || "+91 98765 43210",
      vehicleId: shipment?.vehicle_id || null,
      vehicleNo: shipment?.vehicle?.registration_no || "TN-01-AB-1234",
      companyId: profile?.organization_id || shipment?.organization_id || null,
      companyName: profile?.organizations?.name || shipment?.organization?.name || "ORION Logistics",
      shipmentId: shipment?.id || null,
      latitude: lat,
      longitude: lng,
      speedKmh: speed,
      accuracyM: accuracy,
      networkStatus: typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
      timestamp: nowIso,
    };

    // Save locally for client-side duration calculations
    localStorage.setItem(LAST_PING_KEY, JSON.stringify(pingPayload));

    // Automatically resolve any pending inactivity alerts when driver sends active heartbeat
    await resolveAlertOnDriverReconnect(user.id || profile?.id, profile?.full_name);

    // Post to Supabase profile & gps_locations log
    try {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        // 1. Update Profile status
        await supabase.from("profiles").update({
          status: "active",
        }).eq("id", user.id).catch(() => {});

        // 2. Insert fresh GPS location tick if shipment active
        if (shipment?.id && (lat || lng)) {
          await supabase.from("gps_locations").insert({
            shipment_id: shipment.id,
            lat: lat || shipment.source_lat || 26.1445,
            lng: lng || shipment.source_lng || 91.7362,
            speed_kmh: speed || 0,
            recorded_at: nowIso,
          });
        }
      }
    } catch (err) {
      console.warn("[useDriverHeartbeat] Heartbeat ping error:", err.message);
    }
  }, [user, profile, geo.position, shipment]);

  // Handle Intentional Logout
  const handleIntentionalLogout = useCallback(async (reason = "user_click") => {
    if (!user) return;
    const lastPingRaw = localStorage.getItem(LAST_PING_KEY);
    const lastPing = lastPingRaw ? JSON.parse(lastPingRaw) : null;

    // Check if logging out during active shipment or near danger zone
    const isActiveShipment = shipment && ["in_transit", "delayed", "rerouting"].includes(shipment.status);
    const isNearDangerZone = activeDangerZones.length > 0;

    if (isActiveShipment || isNearDangerZone) {
      // Create UNEXPECTED DRIVER LOGOUT alert for admin review
      await createInactivityAlert({
        driverId: user.id,
        driverName: profile?.full_name || "Driver",
        driverPhone: profile?.phone || "+91 98765 43210",
        vehicleId: shipment?.vehicle_id || null,
        vehicleNo: shipment?.vehicle?.registration_no || "TN-01-AB-1234",
        companyId: profile?.organization_id || null,
        companyName: profile?.organizations?.name || "ORION Logistics",
        shipmentId: shipment?.id || null,
        lastPingAt: lastPing?.timestamp || new Date().toISOString(),
        offlineStartedAt: new Date().toISOString(),
        offlineDurationMinutes: 0,
        latitude: lastPing?.latitude || 26.1445,
        longitude: lastPing?.longitude || 91.7362,
        alertLevel: "UNEXPECTED_LOGOUT",
        status: "COMMUNICATION_LOST",
        finalRiskScore: isNearDangerZone ? 75 : 50,
      });
    }
  }, [user, profile, shipment, activeDangerZones]);

  useEffect(() => {
    if (!user || profile?.role !== "secondary") return;

    // Start geolocation and send initial heartbeat
    geo.start();
    sendHeartbeat();

    heartbeatTimerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, [user, profile, sendHeartbeat]);

  return {
    sendHeartbeat,
    handleIntentionalLogout,
  };
}
