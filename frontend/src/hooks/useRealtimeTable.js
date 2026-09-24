import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Subscribes to Postgres changes on a table via Supabase Realtime and calls
 * `onChange(payload)` for every INSERT/UPDATE/DELETE. Used so Primary and
 * Admin dashboards update live as drivers move / alerts fire, with no manual
 * page refresh (per the "REAL-TIME DATA FLOW" requirement).
 */
export function useRealtimeTable(table, { filter, event = "*", onChange, enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined;

    const channelName = `realtime:${table}:${filter || "all"}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event, schema: "public", table, filter },
        (payload) => onChange?.(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, event, enabled]);
}
