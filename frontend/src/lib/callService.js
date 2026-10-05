import { supabase } from "./supabaseClient";
import { translate } from "./i18n";

// ============================================================================
// Driver calling & call deduplication service.
// ----------------------------------------------------------------------------
// Calls are ONLY initiated after a Transport Manager explicitly confirms a
// route change. Never auto-called on weather changes or AI recommendations.
//
// Driver phone number is retrieved securely from the driver's Supabase profile.
// Prevents duplicate calls for the same confirmed route change.
// ============================================================================

const REASON_MESSAGE_KEY = {
  route_changed: "call.routeChanged",
  danger_zone_marked: "call.dangerZone",
  manual: "call.reasonManual",
};

/** Build the spoken/displayed alert message in the driver's language. */
export function buildCallMessage({ reason, language = "en", detail }) {
  const base = translate(language, REASON_MESSAGE_KEY[reason] || "call.reasonManual");
  return detail ? `${base}. ${detail}` : base;
}

/**
 * Call a driver about an explicitly confirmed route change.
 * Checks for recent duplicate calls for the same shipment & reason.
 */
export async function callDriver({
  shipmentId,
  driver,
  driverId = null,
  initiatedBy,
  reason = "route_changed",
  detail = "",
  _previousRoute = "Route A",
  _newRoute = "Route B",
  _routeChangeId = null,
}) {
  const targetDriverId = driver?.id || driverId;

  // Retrieve fresh driver profile to ensure real phone number from Supabase
  let phone = driver?.phone;
  let preferredLanguage = driver?.preferred_language || "en";

  if (targetDriverId && !phone) {
    try {
      const { data: p } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .eq("id", targetDriverId)
        .single();
      if (p) {
        phone = p.phone || phone;
      }
    } catch {
      // fallback
    }
  }

  // Deduplication check: check if a call for this shipment & reason was logged in the last 60 seconds
  if (shipmentId) {
    const { data: existingCalls } = await supabase
      .from("call_logs")
      .select("*")
      .eq("shipment_id", shipmentId)
      .eq("reason", reason)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingCalls && existingCalls.length > 0) {
      const lastCall = existingCalls[0];
      const elapsedMs = Date.now() - new Date(lastCall.created_at).getTime();
      if (elapsedMs < 60000) {
        // Prevent duplicate call within 60s for the same confirmed route change
        return {
          ...lastCall,
          duplicatePrevented: true,
          message: buildCallMessage({ reason, language: preferredLanguage, detail }),
        };
      }
    }
  }

  const message = buildCallMessage({ reason, language: preferredLanguage, detail });
  let callStatus = "COMPLETED";
  let status = "simulated";
  let source = "demo";

  if (phone) {
    try {
      const { data, error } = await supabase.functions.invoke("place-call", {
        body: { to: phone, message, language: preferredLanguage },
      });
      if (!error && data?.status === "placed") {
        status = "placed";
        source = "real";
        callStatus = "COMPLETED";
      }
    } catch {
      // Fallback to simulated demo call
    }
  }

  const { data: logRow, error: logError } = await supabase
    .from("call_logs")
    .insert({
      shipment_id: shipmentId,
      driver_id: targetDriverId,
      initiated_by: initiatedBy,
      reason,
      message,
      language: preferredLanguage,
      status,
      source,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (logError) throw logError;

  return {
    ...logRow,
    message,
    language: preferredLanguage,
    phone,
    callStatus,
    status,
    source,
    duplicatePrevented: false,
  };
}
