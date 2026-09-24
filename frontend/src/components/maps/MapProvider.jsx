import { createContext, useContext, useEffect, useState } from "react";

// OpenStreetMap tiles + OSRM routing need no API key and no "configured?"
// gate — they just need network access. This provider tracks online/offline
// status so map components can fall back to the DEMO projection when the
// device has no connectivity, matching the app's offline-resilience design.
const MapsCtx = createContext({ isOnline: true });

export function MapProvider({ children }) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return <MapsCtx.Provider value={{ isOnline }}>{children}</MapsCtx.Provider>;
}

export function useMapsStatus() {
  return useContext(MapsCtx);
}
