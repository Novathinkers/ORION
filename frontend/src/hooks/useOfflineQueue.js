import { useCallback, useEffect, useState } from "react";
import { insertGpsPoint } from "../lib/dataService";

const STORAGE_KEY = "ner_offline_gps_queue_v1";

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/**
 * Offline-first GPS queue for the Driver app. Points are always written to
 * localStorage first (works with zero network), then flushed to Supabase
 * when the browser reports `online`. This satisfies the "driver app must
 * work in poor-network areas" requirement without a full IndexedDB layer.
 */
export function useOfflineQueue({ shipmentId, driverId }) {
  const [queueLength, setQueueLength] = useState(() => readQueue().length);
  const [connectivity, setConnectivity] = useState(navigator.onLine ? "online" : "offline");
  const [syncing, setSyncing] = useState(false);

  const enqueue = useCallback((point) => {
    const items = readQueue();
    items.push({ ...point, queued_at: new Date().toISOString() });
    writeQueue(items);
    setQueueLength(items.length);
  }, []);

  const flush = useCallback(async () => {
    const items = readQueue();
    if (items.length === 0 || !shipmentId || !driverId) return;
    setSyncing(true);
    setConnectivity("syncing");
    const remaining = [...items];
    try {
      while (remaining.length > 0) {
        const point = remaining[0];
        // eslint-disable-next-line no-await-in-loop
        await insertGpsPoint({
          shipmentId,
          driverId,
          lat: point.lat,
          lng: point.lng,
          speedKmh: point.speedKmh,
          heading: point.heading,
          accuracyM: point.accuracyM,
          source: point.source || "real",
        });
        remaining.shift();
        writeQueue(remaining);
        setQueueLength(remaining.length);
      }
      setConnectivity("synced");
    } catch (err) {
      // leave whatever's left in the queue for the next attempt
      // eslint-disable-next-line no-console
      console.warn("[offline-queue] sync failed, will retry:", err.message);
      setConnectivity(navigator.onLine ? "online" : "offline");
    } finally {
      setSyncing(false);
    }
  }, [shipmentId, driverId]);

  useEffect(() => {
    const goOnline = () => {
      setConnectivity("online");
      flush();
    };
    const goOffline = () => setConnectivity("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) flush();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId, driverId]);

  return { enqueue, flush, queueLength, connectivity, syncing };
}
