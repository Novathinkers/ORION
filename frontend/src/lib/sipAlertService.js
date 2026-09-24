// ============================================================================
// ORION RouteShield AI — SIP Telephony Alert Service (`sipAlertService.js`)
// ----------------------------------------------------------------------------
// Connects ORION Web Application to local Asterisk PBX API (http://localhost:8765)
// to make real SIP phone calls to Zoiper / mobile phones over local WiFi.
// ============================================================================

const envBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
const API_URLS = envBackendUrl 
  ? [envBackendUrl] 
  : ["http://127.0.0.1:8765", "http://localhost:8765"];

export const VEHICLE_SIP_MAP = {
  demo: { peer: "demo", extension: "1000", driver: "Gokul (Demo)", phone: "+91 98765 26002" },
  gokul: { peer: "gokul", extension: "1000", driver: "Gokul", phone: "+91 98765 26002" },
  truck_001: { peer: "driver1", extension: "1001", driver: "Alex", phone: "+91 98765 00001" },
  truck_002: { peer: "driver2", extension: "1002", driver: "Ramesh", phone: "+91 98765 00002" },
  truck_003: { peer: "driver3", extension: "1003", driver: "Suresh", phone: "+91 98765 00003" },
  truck_004: { peer: "driver4", extension: "1004", driver: "Driver 4", phone: "+91 98765 00004" },
};

/**
 * Checks connection status of the RouteShield Python API & Asterisk PBX AMI
 */
export async function checkSipStatus() {
  for (const url of API_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${url}/status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return {
          online: true,
          amiReachable: !!data.ami_reachable,
          ffmpegAvailable: !!data.ffmpeg_available,
          sipServer: data.sip_server || "127.0.0.1:5060",
          baseUrl: url,
        };
      }
    } catch {
      // try next URL
    }
  }
  return { online: false, amiReachable: false, ffmpegAvailable: false };
}

/**
 * Triggers a real SIP phone call to a vehicle driver via Asterisk PBX API
 */
export async function triggerRealSipCall({
  peer = "demo",
  extension = "1000",
  driverName = "Driver",
  vehicleNo = "TRUCK-102",
  hazardType = "Landslide",
  distanceKm = 1.2,
  road = "NH-44 Corridor",
  customMessage = null,
} = {}) {
  const message =
    customMessage ||
    `Urgent alert for driver ${driverName}, vehicle ${vehicleNo}. Warning: ${hazardType} detected on ${road}, ${distanceKm} kilometers ahead. Reduce speed immediately or follow detour.`;

  for (const baseUrl of API_URLS) {
    try {
      const res = await fetch(`${baseUrl}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extension,
          sip_peer: peer,
          message,
          driver_name: driverName,
          vehicle_number: vehicleNo,
          hazard_type: hazardType,
          distance_km: distanceKm,
          road,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          message: data.message || "SIP Call originated successfully",
          data,
        };
      }
    } catch {
      // try next URL
    }
  }

  return {
    success: false,
    error: "Python API server is not running on http://127.0.0.1:8765. Please open a terminal, cd routeshield-api, and run: python main.py",
  };
}
