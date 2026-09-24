import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Custom Hook: Continuous Network & Internet Connectivity Detection
 * 
 * Tracks:
 * - isOnline: boolean
 * - isOffline: boolean
 * - connectionStatus: 'online' | 'internet_unavailable' | 'offline' | 'restored'
 * 
 * Supports onRestored callback to trigger automatic sync of offline queued emergency alerts.
 */
export function useConnectivity({ onRestored } = {}) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [connectionStatus, setConnectionStatus] = useState(() => (navigator.onLine ? "online" : "offline"));
  const wasOfflineRef = useRef(!isOnline);

  const checkReachability = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setConnectionStatus("offline");
      wasOfflineRef.current = true;
      return false;
    }

    try {
      // Lightweight HTTP HEAD fetch to verify active internet reachability
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch("/orion.png", { method: "HEAD", cache: "no-store", signal: controller.signal });
      clearTimeout(timeoutId);

      const reachable = res.ok || res.status < 500;
      if (reachable) {
        setIsOnline(true);
        if (wasOfflineRef.current) {
          setConnectionStatus("restored");
          wasOfflineRef.current = false;
          onRestored?.();
        } else {
          setConnectionStatus("online");
        }
        return true;
      } else {
        setIsOnline(false);
        setConnectionStatus("internet_unavailable");
        wasOfflineRef.current = true;
        return false;
      }
    } catch {
      // Fallback: If fetch aborts or fails due to CORS/offline network
      if (navigator.onLine) {
        setIsOnline(true);
        setConnectionStatus("online");
        return true;
      }
      setIsOnline(false);
      setConnectionStatus("internet_unavailable");
      wasOfflineRef.current = true;
      return false;
    }
  }, [onRestored]);

  useEffect(() => {
    const handleOnline = () => {
      checkReachability();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnectionStatus("offline");
      wasOfflineRef.current = true;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    checkReachability();

    // Periodic ping every 25 seconds
    const interval = setInterval(checkReachability, 25000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [checkReachability]);

  return {
    isOnline,
    isOffline: !isOnline,
    connectionStatus,
    checkReachability,
  };
}
