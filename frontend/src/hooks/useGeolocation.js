import { useCallback, useRef, useState } from "react";

/**
 * Wraps the browser Geolocation API for continuous tracking with high/low accuracy fallback.
 * Returns { position, error, isTracking, loadingGps, start, stop, requestOnce }.
 */
export function useGeolocation({ onUpdate } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [loadingGps, setLoadingGps] = useState(false);
  const watchIdRef = useRef(null);

  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  const handlePosition = useCallback(
    (pos) => {
      const next = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        speedKmh: pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : null,
        heading: pos.coords.heading,
        timestamp: pos.timestamp,
      };
      setPosition(next);
      setError(null);
      setLoadingGps(false);
      onUpdate?.(next);
    },
    [onUpdate]
  );

  const start = useCallback(() => {
    if (!supported) {
      setError("Geolocation is not supported on this device/browser.");
      return;
    }
    setIsTracking(true);
    setLoadingGps(true);

    const tryWatch = (highAccuracy = true) => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        (err) => {
          if (highAccuracy) {
            // High accuracy failed or timed out — fallback to standard accuracy
            tryWatch(false);
          } else {
            setError(err.message);
            setLoadingGps(false);
          }
        },
        { enableHighAccuracy: highAccuracy, maximumAge: 10000, timeout: highAccuracy ? 8000 : 15000 }
      );
    };

    tryWatch(true);
  }, [supported, handlePosition]);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setLoadingGps(false);
  }, []);

  const requestOnce = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!supported) {
        const err = new Error("Geolocation is not supported on this device/browser.");
        setError(err.message);
        reject(err);
        return;
      }
      setLoadingGps(true);

      // Attempt 1: High accuracy
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          handlePosition(pos);
          resolve(pos);
        },
        () => {
          // Attempt 2: Standard accuracy fallback (Fast network/cell location)
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              handlePosition(pos);
              resolve(pos);
            },
            (err2) => {
              setError(err2.message);
              setLoadingGps(false);
              reject(err2);
            },
            { enableHighAccuracy: false, timeout: 10000 }
          );
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  }, [supported, handlePosition]);

  return { position, error, isTracking, loadingGps, supported, start, stop, requestOnce };
}
