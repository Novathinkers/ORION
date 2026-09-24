// ============================================================================
// Danger-zone route filtering.
// ----------------------------------------------------------------------------
// Pure geometry only — no Supabase calls here (keeps this testable and
// symmetric with mapsService.js / hazardService.js). Danger zones themselves
// are just `incidents` rows with is_danger_zone = true (see dataService.js
// listActiveDangerZones()); an admin creates one by reviewing a driver's
// image-analyzed hazard report.
// ============================================================================

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Does any point on `path` fall within `zone`'s radius? */
export function pathIntersectsZone(path, zone) {
  if (!path || path.length === 0) return false;
  return path.some((p) => haversineKm(p, { lat: zone.lat, lng: zone.lng }) <= (zone.radius_km ?? zone.radiusKm ?? 5));
}

/** Which of the given danger zones does this path cross? */
export function zonesCrossedByPath(path, zones) {
  return (zones || []).filter((z) => pathIntersectsZone(path, z));
}

/**
 * Given a set of candidate routes (e.g. { recommended, alternate }) and the
 * currently active admin-marked danger zones, return which routes are safe
 * to offer and which are blocked (with the zone(s) responsible).
 *
 * "Only the path [that avoids the marked danger zone] is available" — once
 * an admin confirms a danger zone, any candidate route crossing it is
 * removed from consideration; the app surfaces whichever route(s) remain.
 */
export function filterRoutesAgainstDangerZones(routesByKey, zones) {
  const result = {};
  for (const [key, route] of Object.entries(routesByKey)) {
    if (!route) {
      result[key] = { route: null, blocked: false, zones: [] };
      continue;
    }
    const crossed = zonesCrossedByPath(route.overviewPath, zones);
    result[key] = { route, blocked: crossed.length > 0, zones: crossed };
  }
  return result;
}
