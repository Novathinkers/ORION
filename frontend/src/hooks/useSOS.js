import { useState, useCallback, useEffect } from "react";
import { useConnectivity } from "./useConnectivity";
import { useGeolocation } from "./useGeolocation";
import { useAuth } from "../contexts/AuthContext";
import { createSosAlert, syncQueuedSosAlerts, listSosAlerts } from "../lib/sosService";
import { readOfflineSosQueue } from "../lib/emergencyCommunicationService";

/**
 * Custom React Hook: Offline SOS Emergency System Management
 */
export function useSOS() {
  const { user, profile } = useAuth();
  const geo = useGeolocation();
  const [sosStatus, setSosStatus] = useState("IDLE"); // IDLE | SENDING | DELIVERED | OFFLINE_QUEUED | FAILED
  const [lastResult, setLastResult] = useState(null);
  const [queuedAlerts, setQueuedAlerts] = useState(() => readOfflineSosQueue());
  const [allAlerts, setAllAlerts] = useState([]);
  const [syncNotice, setSyncNotice] = useState("");

  const refreshQueue = useCallback(() => {
    setQueuedAlerts(readOfflineSosQueue());
  }, []);

  const handleConnectionRestored = useCallback(async () => {
    setSyncNotice("✓ Connection restored. Sending queued emergency alerts...");
    const result = await syncQueuedSosAlerts();
    refreshQueue();

    if (result.syncedCount > 0) {
      setSyncNotice(`✓ Connection restored. Successfully sent ${result.syncedCount} queued emergency alert(s).`);
      setSosStatus("DELIVERED");
    } else {
      setSyncNotice("");
    }

    // Clear notice after 6s
    setTimeout(() => setSyncNotice(""), 6000);
  }, [refreshQueue]);

  const { isOnline, isOffline, connectionStatus } = useConnectivity({
    onRestored: handleConnectionRestored,
  });

  // Fetch all alerts
  const loadAlerts = useCallback(async () => {
    const list = await listSosAlerts();
    setAllAlerts(list);
    refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Primary SOS Trigger
  const triggerSOS = useCallback(
    async ({ emergencyType = "Other Emergency", message = "Emergency alert triggered", shipment = null, vehicle = null } = {}) => {
      setSosStatus("SENDING");
      setSyncNotice("");

      // 1. Gather GPS location (current or last known fallback)
      let lat = geo.position?.lat || null;
      let lng = geo.position?.lng || null;
      let accuracy = geo.position?.accuracyM || null;
      let locTimestamp = geo.position?.timestamp ? new Date(geo.position.timestamp).toISOString() : new Date().toISOString();

      if (!lat || !lng) {
        // Attempt quick requestOnce or fallback to Guwahati/NER center
        try {
          const p = await geo.requestOnce();
          lat = p.coords.latitude;
          lng = p.coords.longitude;
          accuracy = p.coords.accuracy;
        } catch {
          lat = 26.1445;
          lng = 91.7362;
        }
      }

      // 2. Build SOS Payload
      const sosPayload = {
        driverId: user?.id || profile?.id || null,
        driverName: profile?.full_name || user?.email?.split("@")[0] || "Arun Kumar (Driver)",
        driverPhone: profile?.phone || "+91 98765 43210",
        vehicleId: vehicle?.id || shipment?.vehicle_id || null,
        vehicleNo: vehicle?.registration_no || shipment?.vehicle?.registration_no || "TN-01-AB-1234",
        companyId: profile?.organization_id || shipment?.organization_id || null,
        companyName: profile?.organizations?.name || shipment?.organization?.name || "ORION Logistics",
        shipmentId: shipment?.id || null,
        routeId: shipment?.route_id || "ROUTE_NER_MAIN",
        emergencyType,
        message,
        latitude: lat,
        longitude: lng,
        locationAccuracy: accuracy,
        locationTimestamp: locTimestamp,
        timestamp: new Date().toISOString(),
      };

      // 3. Dispatch via Communication Architecture
      const result = await createSosAlert(sosPayload);
      setLastResult(result);

      if (result.status === "DELIVERED") {
        setSosStatus("DELIVERED");
      } else if (result.status === "OFFLINE_QUEUED") {
        setSosStatus("OFFLINE_QUEUED");
      } else {
        setSosStatus(result.success ? "SENT" : "FAILED");
      }

      refreshQueue();
      loadAlerts();
      return result;
    },
    [user, profile, geo, refreshQueue, loadAlerts]
  );

  // Quick SOS (Immediate trigger without selecting type)
  const triggerQuickSOS = useCallback(
    async (extra = {}) => {
      return triggerSOS({
        emergencyType: "Quick SOS Alert",
        message: "🚨 QUICK SOS TRIPPED: Emergency alert triggered instantly by driver",
        ...extra,
      });
    },
    [triggerSOS]
  );

  return {
    triggerSOS,
    triggerQuickSOS,
    sosStatus,
    lastResult,
    queuedAlerts,
    allAlerts,
    isOnline,
    isOffline,
    connectionStatus,
    syncNotice,
    loadAlerts,
    refreshQueue,
  };
}
