// ============================================================================
// Maps service abstraction — Pan-India Routing & Specialized NER Intelligence
//
// Provider: OpenStreetMap ecosystem — completely free, no API key required:
//   - Tiles:    OpenStreetMap Standard Tiles
//   - Routing:  OSRM public demo server (router.project-osrm.org)
//   - Geocoding: Nominatim India (nominatim.openstreetmap.org)
// ============================================================================

export const MAPS_PROVIDER = "openstreetmap";

const OSRM_BASE_URL = "https://router.project-osrm.org";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

const DEMO_AVG_SPEED_KMH = 45;

/** Default Map Center: Geographic Center of India */
export const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

/**
 * Check if a lat/lng coordinate is located within the North Eastern Region (NER)
 * NER Bounding Box: Lat 21.5°N - 29.5°N, Lng 87.5°E - 97.5°E
 */
export function isLocationInNer(lat, lng) {
  if (lat == null || lng == null) return false;
  return lat >= 21.5 && lat <= 29.5 && lng >= 87.5 && lng <= 97.5;
}

/** Check if any point along a route path intersects the North Eastern Region */
export function isRouteInNer(path = []) {
  if (!path || path.length === 0) return false;
  return path.some((p) => isLocationInNer(p.lat, p.lng));
}

async function fetchJsonWithTimeout(url, { timeoutMs = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Great-circle distance in km between two {lat,lng} points. */
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Build a curved multi-point DEMO path between two points. */
function demoPath(origin, destination, jitterSeed = 0) {
  const points = [];
  const steps = 15;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = origin.lat + (destination.lat - origin.lat) * t;
    const lng = origin.lng + (destination.lng - origin.lng) * t;
    const wobble = Math.sin(t * Math.PI + jitterSeed) * 0.05 * (1 - Math.abs(t - 0.5) * 2);
    points.push({ lat: lat + wobble, lng: lng - wobble * 0.6 });
  }
  return points;
}

function demoRoutePair(origin, destination) {
  const distanceKm = haversineKm(origin, destination) * 1.28;
  const recommendedPath = demoPath(origin, destination, 0);
  const alternatePath = demoPath(origin, destination, Math.PI / 2);
  const alternateDistanceKm = distanceKm * 1.12;

  const inNer = isRouteInNer(recommendedPath);

  return {
    source: "demo",
    isNerRoute: inNer,
    recommended: {
      overviewPath: recommendedPath,
      distanceKm,
      durationMin: (distanceKm / (inNer ? 38 : DEMO_AVG_SPEED_KMH)) * 60,
      summary: inNer ? "Recommended NER Intelligent Route (DEMO)" : "Recommended Pan-India Route (DEMO)",
    },
    alternate: {
      overviewPath: alternatePath,
      distanceKm: alternateDistanceKm,
      durationMin: (alternateDistanceKm / (inNer ? 35 : DEMO_AVG_SPEED_KMH * 0.94)) * 60,
      summary: inNer ? "Alternate NER Detour Route (DEMO)" : "Alternate Pan-India Route (DEMO)",
    },
  };
}

/**
 * Compute a recommended route + alternate route between ANY two points in India.
 * Uses OSRM (free, no key) across India.
 */
export async function computeRoute({ origin, destination }) {
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;

  if (isOnline) {
    try {
      const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=true&steps=false`;
      const data = await fetchJsonWithTimeout(url);

      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        throw new Error(data.message || "No route returned by OSRM");
      }

      const toRoute = (r, label) => {
        const path = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        return {
          overviewPath: path,
          distanceKm: r.distance / 1000,
          durationMin: r.duration / 60,
          summary: label,
        };
      };

      const routes = data.routes.map((r, i) => toRoute(r, i === 0 ? "Recommended Pan-India Route (OSM/OSRM)" : "Alternate Route (OSM/OSRM)"));
      const inNer = isRouteInNer(routes[0].overviewPath);

      return {
        source: "real",
        isNerRoute: inNer,
        recommended: routes[0],
        alternate: routes[1] || null,
      };
    } catch (err) {
      console.warn("[mapsService] OSRM routing failed, falling back to DEMO route:", err.message);
    }
  }

  return demoRoutePair(origin, destination);
}

/** Search location anywhere in India using Nominatim or curated locations */
export async function searchLocations(query) {
  if (!query || query.trim().length < 2) return INDIA_LOCATIONS;
  const q = query.toLowerCase().trim();

  // Local matching first
  const localHits = INDIA_LOCATIONS.filter(
    (loc) => loc.name.toLowerCase().includes(q) || loc.state?.toLowerCase().includes(q)
  );

  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (!isOnline) return localHits;

  try {
    const url = `${NOMINATIM_BASE_URL}/search?format=json&countrycodes=in&limit=8&q=${encodeURIComponent(query)}`;
    const results = await fetchJsonWithTimeout(url, { headers: { Accept: "application/json" } });

    if (results && results.length > 0) {
      const remoteHits = results.map((r) => ({
        name: r.display_name.split(",").slice(0, 3).join(","),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        fullName: r.display_name,
        isNer: isLocationInNer(parseFloat(r.lat), parseFloat(r.lon)),
      }));

      // Combine local & remote results, removing duplicate names
      const seen = new Set();
      const combined = [];
      for (const item of [...localHits, ...remoteHits]) {
        if (!seen.has(item.name)) {
          seen.add(item.name);
          combined.push(item);
        }
      }
      return combined;
    }
  } catch (err) {
    console.warn("[mapsService] Pan-India location search fallback:", err.message);
  }

  return localHits;
}

/** Geocode a place name to {lat,lng} */
export async function geocode({ address }) {
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (!isOnline || !address) return null;

  try {
    const url = `${NOMINATIM_BASE_URL}/search?format=json&countrycodes=in&limit=1&q=${encodeURIComponent(address)}`;
    const results = await fetchJsonWithTimeout(url, { headers: { Accept: "application/json" } });
    if (results && results[0]) {
      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      return {
        source: "real",
        lat,
        lng,
        formattedAddress: results[0].display_name,
        isNer: isLocationInNer(lat, lng),
      };
    }
  } catch (err) {
    console.warn("[mapsService] Nominatim geocoding failed:", err.message);
  }
  return null;
}

/** Progress (0-1) of a point along a route's overview path */
export function routeProgress(path, current) {
  if (!path || path.length < 2) return 0;
  let bestT = 0;
  let bestDist = Infinity;
  let cumulative = 0;
  const cumulativeAtIndex = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative += haversineKm(path[i - 1], path[i]);
    cumulativeAtIndex.push(cumulative);
  }
  const total = cumulative || 1;
  path.forEach((p, i) => {
    const d = haversineKm(p, current);
    if (d < bestDist) {
      bestDist = d;
      bestT = cumulativeAtIndex[i] / total;
    }
  });
  return { t: bestT, deviationKm: bestDist };
}

export function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatEta(date) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-IN", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Auto-detect user's approximate current location via free IP geolocation service
 * as a seamless fallback if browser GPS permission is blocked or denied.
 */
export async function fetchIpLocation() {
  try {
    const data = await fetchJsonWithTimeout("https://ipapi.co/json/", { timeoutMs: 5000 });
    if (data && data.latitude && data.longitude) {
      const city = data.city || data.region || "Current Region";
      return {
        source: "ip",
        name: `📍 IP Location (${city})`,
        lat: parseFloat(data.latitude),
        lng: parseFloat(data.longitude),
        city: data.city,
        region: data.region,
      };
    }
  } catch (err) {
    console.warn("[mapsService] IP location fallback lookup:", err.message);
  }
  return null;
}

// Curated set of all major Cities, Districts & Sub-districts across 28 States & 8 UTs of India
export const INDIA_LOCATIONS = [
  // --- North Eastern Region (NER) ---
  { name: "Dispur, Kamrup Metro (Sub-dist: Dispur, Dist: Kamrup Metropolitan), Assam", lat: 26.1433, lng: 91.7898, state: "Assam", district: "Kamrup Metropolitan", subdistrict: "Dispur", isNer: true },
  { name: "Guwahati Sadar (Dist: Kamrup Metropolitan), Assam", lat: 26.1445, lng: 91.7362, state: "Assam", district: "Kamrup Metropolitan", subdistrict: "Guwahati Sadar", isNer: true },
  { name: "Sonapur (Sub-dist: Sonapur, Dist: Kamrup Metropolitan), Assam", lat: 26.1189, lng: 91.9782, state: "Assam", district: "Kamrup Metropolitan", subdistrict: "Sonapur", isNer: true },
  { name: "Amingaon (Sub-dist: Hajo, Dist: Kamrup Rural), Assam", lat: 26.1867, lng: 91.6822, state: "Assam", district: "Kamrup Rural", subdistrict: "Hajo", isNer: true },
  { name: "Rangia (Sub-dist: Rangia, Dist: Kamrup Rural), Assam", lat: 26.4383, lng: 91.6317, state: "Assam", district: "Kamrup Rural", subdistrict: "Rangia", isNer: true },
  { name: "Dibrugarh Sadar (Dist: Dibrugarh), Assam", lat: 27.4728, lng: 94.912, state: "Assam", district: "Dibrugarh", subdistrict: "Dibrugarh Sadar", isNer: true },
  { name: "Moran (Sub-dist: Moran, Dist: Dibrugarh), Assam", lat: 27.1812, lng: 94.9298, state: "Assam", district: "Dibrugarh", subdistrict: "Moran", isNer: true },
  { name: "Silchar (Sub-dist: Silchar Sadar, Dist: Cachar), Assam", lat: 24.8333, lng: 92.7789, state: "Assam", district: "Cachar", subdistrict: "Silchar Sadar", isNer: true },
  { name: "Lakhipur (Sub-dist: Lakhipur, Dist: Cachar), Assam", lat: 24.7954, lng: 93.0116, state: "Assam", district: "Cachar", subdistrict: "Lakhipur", isNer: true },
  { name: "Tezpur (Sub-dist: Tezpur Sadar, Dist: Sonitpur), Assam", lat: 26.6528, lng: 92.8, state: "Assam", district: "Sonitpur", subdistrict: "Tezpur Sadar", isNer: true },
  { name: "Margherita (Sub-dist: Margherita, Dist: Tinsukia), Assam", lat: 27.2806, lng: 95.6765, state: "Assam", district: "Tinsukia", subdistrict: "Margherita", isNer: true },
  { name: "Bokakhat (Sub-dist: Bokakhat, Dist: Golaghat), Assam", lat: 26.6347, lng: 93.5939, state: "Assam", district: "Golaghat", subdistrict: "Bokakhat", isNer: true },
  { name: "Jorhat (Sub-dist: Jorhat Sadar, Dist: Jorhat), Assam", lat: 26.7509, lng: 94.2037, state: "Assam", district: "Jorhat", subdistrict: "Jorhat Sadar", isNer: true },
  { name: "Nagaon (Dist: Nagaon), Assam", lat: 26.3465, lng: 92.6841, state: "Assam", district: "Nagaon", isNer: true },
  { name: "Bongaigaon (Dist: Bongaigaon), Assam", lat: 26.478, lng: 90.5583, state: "Assam", district: "Bongaigaon", isNer: true },
  { name: "Dhubri (Dist: Dhubri), Assam", lat: 26.0207, lng: 89.9723, state: "Assam", district: "Dhubri", isNer: true },
  { name: "Shillong (Sub-dist: Mylliem, Dist: East Khasi Hills), Meghalaya", lat: 25.5788, lng: 91.8933, state: "Meghalaya", district: "East Khasi Hills", subdistrict: "Mylliem", isNer: true },
  { name: "Sohra / Cherrapunji (Sub-dist: Sohra, Dist: East Khasi Hills), Meghalaya", lat: 25.2986, lng: 91.7301, state: "Meghalaya", district: "East Khasi Hills", subdistrict: "Sohra", isNer: true },
  { name: "Tura (Sub-dist: Tura Sadar, Dist: West Garo Hills), Meghalaya", lat: 25.5141, lng: 90.2032, state: "Meghalaya", district: "West Garo Hills", subdistrict: "Tura Sadar", isNer: true },
  { name: "Nongpoh (Sub-dist: Umling, Dist: Ri-Bhoi), Meghalaya", lat: 25.9038, lng: 91.8804, state: "Meghalaya", district: "Ri-Bhoi", subdistrict: "Umling", isNer: true },
  { name: "Itanagar (Sub-dist: Itanagar Sadar, Dist: Papum Pare), Arunachal Pradesh", lat: 27.0844, lng: 93.6053, state: "Arunachal Pradesh", district: "Papum Pare", subdistrict: "Itanagar Sadar", isNer: true },
  { name: "Naharlagun (Sub-dist: Naharlagun, Dist: Papum Pare), Arunachal Pradesh", lat: 27.1062, lng: 93.6931, state: "Arunachal Pradesh", district: "Papum Pare", subdistrict: "Naharlagun", isNer: true },
  { name: "Pasighat (Dist: East Siang), Arunachal Pradesh", lat: 28.0664, lng: 95.3262, state: "Arunachal Pradesh", district: "East Siang", isNer: true },
  { name: "Dirang (Sub-dist: Dirang, Dist: West Kameng), Arunachal Pradesh", lat: 27.3571, lng: 92.2415, state: "Arunachal Pradesh", district: "West Kameng", subdistrict: "Dirang", isNer: true },
  { name: "Imphal (Sub-dist: Lamphelpat, Dist: Imphal West), Manipur", lat: 24.817, lng: 93.9368, state: "Manipur", district: "Imphal West", subdistrict: "Lamphelpat", isNer: true },
  { name: "Porompat (Sub-dist: Porompat, Dist: Imphal East), Manipur", lat: 24.8124, lng: 93.9622, state: "Manipur", district: "Imphal East", subdistrict: "Porompat", isNer: true },
  { name: "Churachandpur (Dist: Churachandpur), Manipur", lat: 24.3333, lng: 93.6833, state: "Manipur", district: "Churachandpur", isNer: true },
  { name: "Kohima (Sub-dist: Kohima Sadar, Dist: Kohima), Nagaland", lat: 25.6751, lng: 94.1086, state: "Nagaland", district: "Kohima", subdistrict: "Kohima Sadar", isNer: true },
  { name: "Dimapur (Sub-dist: Dimapur Sadar, Dist: Dimapur), Nagaland", lat: 25.9091, lng: 93.7266, state: "Nagaland", district: "Dimapur", subdistrict: "Dimapur Sadar", isNer: true },
  { name: "Chumoukedima (Dist: Chumoukedima), Nagaland", lat: 25.8291, lng: 93.7741, state: "Nagaland", district: "Chumoukedima", subdistrict: "Chumoukedima", isNer: true },
  { name: "Aizawl (Dist: Aizawl), Mizoram", lat: 23.7271, lng: 92.7176, state: "Mizoram", district: "Aizawl", subdistrict: "Aizawl Sadar", isNer: true },
  { name: "Lunglei (Dist: Lunglei), Mizoram", lat: 22.8876, lng: 92.7358, state: "Mizoram", district: "Lunglei", isNer: true },
  { name: "Agartala (Sub-dist: Sadar, Dist: West Tripura), Tripura", lat: 23.8315, lng: 91.2868, state: "Tripura", district: "West Tripura", subdistrict: "Sadar", isNer: true },
  { name: "Dharmanagar (Dist: North Tripura), Tripura", lat: 24.37, lng: 92.16, state: "Tripura", district: "North Tripura", isNer: true },
  { name: "Gangtok (Dist: East Sikkim / Gangtok), Sikkim", lat: 27.3389, lng: 88.6065, state: "Sikkim", district: "Gangtok", subdistrict: "Gangtok Sadar", isNer: true },
  { name: "Pakyong (Sub-dist: Pakyong, Dist: Pakyong), Sikkim", lat: 27.2405, lng: 88.5922, state: "Sikkim", district: "Pakyong", subdistrict: "Pakyong", isNer: true },

  // --- Northern India ---
  { name: "New Delhi (Dist: New Delhi), Delhi", lat: 28.6139, lng: 77.209, state: "Delhi", district: "New Delhi", subdistrict: "Central Delhi" },
  { name: "Dwarka (Sub-dist: Dwarka, Dist: South West Delhi), Delhi", lat: 28.5921, lng: 77.046, state: "Delhi", district: "South West Delhi", subdistrict: "Dwarka" },
  { name: "Gurugram (Dist: Gurugram), Haryana", lat: 28.4595, lng: 77.0266, state: "Haryana", district: "Gurugram" },
  { name: "Faridabad (Dist: Faridabad), Haryana", lat: 28.4089, lng: 77.3178, state: "Haryana", district: "Faridabad" },
  { name: "Panipat (Dist: Panipat), Haryana", lat: 29.3909, lng: 76.9635, state: "Haryana", district: "Panipat" },
  { name: "Ambala (Dist: Ambala), Haryana", lat: 30.3782, lng: 76.7767, state: "Haryana", district: "Ambala" },
  { name: "Chandigarh (Dist: Chandigarh), Union Territory", lat: 30.7333, lng: 76.7794, state: "Chandigarh", district: "Chandigarh" },
  { name: "Ludhiana (Dist: Ludhiana), Punjab", lat: 30.901, lng: 75.8573, state: "Punjab", district: "Ludhiana" },
  { name: "Amritsar (Dist: Amritsar), Punjab", lat: 31.634, lng: 74.8723, state: "Punjab", district: "Amritsar" },
  { name: "Jalandhar (Dist: Jalandhar), Punjab", lat: 31.326, lng: 75.5762, state: "Punjab", district: "Jalandhar" },
  { name: "Patiala (Dist: Patiala), Punjab", lat: 30.3398, lng: 76.3869, state: "Punjab", district: "Patiala" },
  { name: "Srinagar (Dist: Srinagar), Jammu and Kashmir", lat: 34.0837, lng: 74.7973, state: "Jammu and Kashmir", district: "Srinagar" },
  { name: "Jammu (Dist: Jammu), Jammu and Kashmir", lat: 32.7266, lng: 74.857, state: "Jammu and Kashmir", district: "Jammu" },
  { name: "Leh (Dist: Leh), Ladakh", lat: 34.1526, lng: 77.5771, state: "Ladakh", district: "Leh" },
  { name: "Kargil (Dist: Kargil), Ladakh", lat: 34.5539, lng: 76.1349, state: "Ladakh", district: "Kargil" },
  { name: "Shimla (Dist: Shimla), Himachal Pradesh", lat: 31.1048, lng: 77.1734, state: "Himachal Pradesh", district: "Shimla" },
  { name: "Dharamshala (Dist: Kangra), Himachal Pradesh", lat: 32.219, lng: 76.3234, state: "Himachal Pradesh", district: "Kangra" },
  { name: "Manali (Dist: Kullu), Himachal Pradesh", lat: 32.2432, lng: 77.1892, state: "Himachal Pradesh", district: "Kullu" },
  { name: "Dehradun (Dist: Dehradun), Uttarakhand", lat: 30.3165, lng: 78.0322, state: "Uttarakhand", district: "Dehradun" },
  { name: "Haridwar (Dist: Haridwar), Uttarakhand", lat: 29.9457, lng: 78.1642, state: "Uttarakhand", district: "Haridwar" },
  { name: "Haldwani (Dist: Nainital), Uttarakhand", lat: 29.2183, lng: 79.513, state: "Uttarakhand", district: "Nainital" },

  // --- Western & Central India ---
  { name: "Mumbai (Dist: Mumbai City / Suburban), Maharashtra", lat: 19.076, lng: 72.8777, state: "Maharashtra", district: "Mumbai Suburban", subdistrict: "Andheri" },
  { name: "Thane (Sub-dist: Thane Sadar, Dist: Thane), Maharashtra", lat: 19.2183, lng: 72.9781, state: "Maharashtra", district: "Thane", subdistrict: "Thane Sadar" },
  { name: "Kalyan (Sub-dist: Kalyan Taluka, Dist: Thane), Maharashtra", lat: 19.2403, lng: 73.1305, state: "Maharashtra", district: "Thane", subdistrict: "Kalyan" },
  { name: "Pune City (Sub-dist: Haveli, Dist: Pune), Maharashtra", lat: 18.5204, lng: 73.8567, state: "Maharashtra", district: "Pune", subdistrict: "Haveli" },
  { name: "Pimpri-Chinchwad (Sub-dist: PCMC, Dist: Pune), Maharashtra", lat: 18.6298, lng: 73.7997, state: "Maharashtra", district: "Pune", subdistrict: "Pimpri-Chinchwad" },
  { name: "Nagpur (Dist: Nagpur), Maharashtra", lat: 21.1458, lng: 79.0882, state: "Maharashtra", district: "Nagpur" },
  { name: "Nashik (Dist: Nashik), Maharashtra", lat: 19.9975, lng: 73.7898, state: "Maharashtra", district: "Nashik" },
  { name: "Chhatrapati Sambhajinagar / Aurangabad (Dist: Aurangabad), Maharashtra", lat: 19.8762, lng: 75.3433, state: "Maharashtra", district: "Aurangabad" },
  { name: "Solapur (Dist: Solapur), Maharashtra", lat: 17.6599, lng: 75.9064, state: "Maharashtra", district: "Solapur" },
  { name: "Kolhapur (Dist: Kolhapur), Maharashtra", lat: 16.705, lng: 74.2433, state: "Maharashtra", district: "Kolhapur" },
  { name: "Ahmedabad (Sub-dist: Ahmedabad City, Dist: Ahmedabad), Gujarat", lat: 23.0225, lng: 72.5714, state: "Gujarat", district: "Ahmedabad", subdistrict: "Ahmedabad City" },
  { name: "Surat (Dist: Surat), Gujarat", lat: 21.1702, lng: 72.8311, state: "Gujarat", district: "Surat" },
  { name: "Vadodara (Dist: Vadodara), Gujarat", lat: 22.3072, lng: 73.1812, state: "Gujarat", district: "Vadodara" },
  { name: "Rajkot (Dist: Rajkot), Gujarat", lat: 22.3039, lng: 70.8022, state: "Gujarat", district: "Rajkot" },
  { name: "Panaji (Dist: North Goa), Goa", lat: 15.4909, lng: 73.8278, state: "Goa", district: "North Goa" },
  { name: "Margao (Dist: South Goa), Goa", lat: 15.2832, lng: 73.9862, state: "Goa", district: "South Goa" },
  { name: "Bhopal (Dist: Bhopal), Madhya Pradesh", lat: 23.2599, lng: 77.4126, state: "Madhya Pradesh", district: "Bhopal" },
  { name: "Indore (Dist: Indore), Madhya Pradesh", lat: 22.7196, lng: 75.8577, state: "Madhya Pradesh", district: "Indore" },
  { name: "Gwalior (Dist: Gwalior), Madhya Pradesh", lat: 26.2183, lng: 78.1828, state: "Madhya Pradesh", district: "Gwalior" },
  { name: "Jabalpur (Dist: Jabalpur), Madhya Pradesh", lat: 23.1815, lng: 79.9864, state: "Madhya Pradesh", district: "Jabalpur" },
  { name: "Ujjain (Dist: Ujjain), Madhya Pradesh", lat: 23.1765, lng: 75.7885, state: "Madhya Pradesh", district: "Ujjain" },
  { name: "Raipur (Dist: Raipur), Chhattisgarh", lat: 21.2514, lng: 81.6296, state: "Chhattisgarh", district: "Raipur" },
  { name: "Bhilai / Durg (Dist: Durg), Chhattisgarh", lat: 21.1938, lng: 81.3509, state: "Chhattisgarh", district: "Durg" },
  { name: "Bilaspur (Dist: Bilaspur), Chhattisgarh", lat: 22.0797, lng: 82.1391, state: "Chhattisgarh", district: "Bilaspur" },

  // --- Eastern & Central India ---
  { name: "Kolkata (Dist: Kolkata Sadar), West Bengal", lat: 22.5726, lng: 88.3639, state: "West Bengal", district: "Kolkata", subdistrict: "Kolkata Sadar" },
  { name: "Howrah (Dist: Howrah), West Bengal", lat: 22.5958, lng: 88.2636, state: "West Bengal", district: "Howrah" },
  { name: "Siliguri (Sub-dist: Siliguri Sub-div, Dist: Darjeeling), West Bengal", lat: 26.7271, lng: 88.3953, state: "West Bengal", district: "Darjeeling", subdistrict: "Siliguri", isNer: true },
  { name: "Kurseong (Sub-dist: Kurseong Sub-div, Dist: Darjeeling), West Bengal", lat: 26.8812, lng: 88.2781, state: "West Bengal", district: "Darjeeling", subdistrict: "Kurseong", isNer: true },
  { name: "Barasat (Sub-dist: Barasat Sadar, Dist: North 24 Parganas), West Bengal", lat: 22.7234, lng: 88.4816, state: "West Bengal", district: "North 24 Parganas", subdistrict: "Barasat" },
  { name: "Asansol (Dist: Paschim Bardhaman), West Bengal", lat: 23.6889, lng: 86.9661, state: "West Bengal", district: "Paschim Bardhaman" },
  { name: "Durgapur (Dist: Paschim Bardhaman), West Bengal", lat: 23.5204, lng: 87.3119, state: "West Bengal", district: "Paschim Bardhaman" },
  { name: "Patna (Sub-dist: Patna Sadar, Dist: Patna), Bihar", lat: 25.5941, lng: 85.1376, state: "Bihar", district: "Patna", subdistrict: "Patna Sadar" },
  { name: "Gaya (Dist: Gaya), Bihar", lat: 24.7914, lng: 85.0002, state: "Bihar", district: "Gaya" },
  { name: "Muzaffarpur (Dist: Muzaffarpur), Bihar", lat: 26.1209, lng: 85.3647, state: "Bihar", district: "Muzaffarpur" },
  { name: "Bhagalpur (Dist: Bhagalpur), Bihar", lat: 25.2425, lng: 87.0135, state: "Bihar", district: "Bhagalpur" },
  { name: "Ranchi (Dist: Ranchi), Jharkhand", lat: 23.3441, lng: 85.3096, state: "Jharkhand", district: "Ranchi" },
  { name: "Jamshedpur (Dist: East Singhbhum), Jharkhand", lat: 22.8046, lng: 86.2029, state: "Jharkhand", district: "East Singhbhum" },
  { name: "Dhanbad (Dist: Dhanbad), Jharkhand", lat: 23.7957, lng: 86.4304, state: "Jharkhand", district: "Dhanbad" },
  { name: "Bhubaneswar (Sub-dist: Bhubaneswar Sadar, Dist: Khordha), Odisha", lat: 20.2961, lng: 85.8245, state: "Odisha", district: "Khordha", subdistrict: "Bhubaneswar" },
  { name: "Cuttack (Dist: Cuttack), Odisha", lat: 20.4625, lng: 85.8828, state: "Odisha", district: "Cuttack" },
  { name: "Rourkela (Dist: Sundargarh), Odisha", lat: 22.2604, lng: 84.8536, state: "Odisha", district: "Sundargarh" },
  { name: "Puri (Dist: Puri), Odisha", lat: 19.8135, lng: 85.8312, state: "Odisha", district: "Puri" },

  // --- Southern India ---
  { name: "Bengaluru City (Dist: Bengaluru Urban), Karnataka", lat: 12.9716, lng: 77.5946, state: "Karnataka", district: "Bengaluru Urban", subdistrict: "Bengaluru South" },
  { name: "Whitefield (Sub-dist: Bengaluru East, Dist: Bengaluru Urban), Karnataka", lat: 12.9698, lng: 77.7499, state: "Karnataka", district: "Bengaluru Urban", subdistrict: "Bengaluru East" },
  { name: "Mysuru (Sub-dist: Mysuru Taluk, Dist: Mysuru), Karnataka", lat: 12.2958, lng: 76.6394, state: "Karnataka", district: "Mysuru", subdistrict: "Mysuru Sadar" },
  { name: "Mangaluru (Dist: Dakshina Kannada), Karnataka", lat: 12.9141, lng: 74.856, state: "Karnataka", district: "Dakshina Kannada" },
  { name: "Hubballi-Dharwad (Dist: Dharwad), Karnataka", lat: 15.3647, lng: 75.124, state: "Karnataka", district: "Dharwad" },
  { name: "Belagavi / Belgaum (Dist: Belagavi), Karnataka", lat: 15.8497, lng: 74.4977, state: "Karnataka", district: "Belagavi" },
  { name: "Chennai City (Dist: Chennai), Tamil Nadu", lat: 13.0827, lng: 80.2707, state: "Tamil Nadu", district: "Chennai", subdistrict: "Egmore-Nungambakkam" },
  { name: "Coimbatore (Sub-dist: Coimbatore South, Dist: Coimbatore), Tamil Nadu", lat: 11.0168, lng: 76.9558, state: "Tamil Nadu", district: "Coimbatore", subdistrict: "Coimbatore South" },
  { name: "Madurai (Dist: Madurai), Tamil Nadu", lat: 9.9252, lng: 78.1198, state: "Tamil Nadu", district: "Madurai" },
  { name: "Tiruchirappalli / Trichy (Dist: Tiruchirappalli), Tamil Nadu", lat: 10.7905, lng: 78.7047, state: "Tamil Nadu", district: "Tiruchirappalli" },
  { name: "Salem (Dist: Salem), Tamil Nadu", lat: 11.6643, lng: 78.146, state: "Tamil Nadu", district: "Salem" },
  { name: "Tirunelveli (Dist: Tirunelveli), Tamil Nadu", lat: 8.7139, lng: 77.7567, state: "Tamil Nadu", district: "Tirunelveli" },
  { name: "Hyderabad (Dist: Hyderabad), Telangana", lat: 17.385, lng: 78.4867, state: "Telangana", district: "Hyderabad", subdistrict: "Charminar / Khairatabad" },
  { name: "Warangal (Dist: Hanamkonda / Warangal), Telangana", lat: 17.9689, lng: 79.5941, state: "Telangana", district: "Warangal" },
  { name: "Nizamabad (Dist: Nizamabad), Telangana", lat: 18.6725, lng: 78.0941, state: "Telangana", district: "Nizamabad" },
  { name: "Visakhapatnam (Dist: Visakhapatnam), Andhra Pradesh", lat: 17.6868, lng: 83.2185, state: "Andhra Pradesh", district: "Visakhapatnam" },
  { name: "Vijayawada (Dist: NTR / Krishna), Andhra Pradesh", lat: 16.5062, lng: 80.648, state: "Andhra Pradesh", district: "NTR" },
  { name: "Guntur (Dist: Guntur), Andhra Pradesh", lat: 16.3067, lng: 80.4365, state: "Andhra Pradesh", district: "Guntur" },
  { name: "Tirupati (Dist: Tirupati), Andhra Pradesh", lat: 13.6288, lng: 79.4192, state: "Andhra Pradesh", district: "Tirupati" },
  { name: "Kochi / Ernakulam (Sub-dist: Kanayannur Taluk, Dist: Ernakulam), Kerala", lat: 9.9312, lng: 76.2673, state: "Kerala", district: "Ernakulam", subdistrict: "Kanayannur" },
  { name: "Aluva (Sub-dist: Aluva Taluk, Dist: Ernakulam), Kerala", lat: 10.1076, lng: 76.3516, state: "Kerala", district: "Ernakulam", subdistrict: "Aluva" },
  { name: "Thiruvananthapuram / Trivandrum (Dist: Thiruvananthapuram), Kerala", lat: 8.5241, lng: 76.9366, state: "Kerala", district: "Thiruvananthapuram" },
  { name: "Kozhikode / Calicut (Dist: Kozhikode), Kerala", lat: 11.2588, lng: 75.7804, state: "Kerala", district: "Kozhikode" },
  { name: "Thrissur (Dist: Thrissur), Kerala", lat: 10.5276, lng: 76.2144, state: "Kerala", district: "Thrissur" },
  { name: "Puducherry (Dist: Puducherry), Puducherry UT", lat: 11.9416, lng: 79.8083, state: "Puducherry", district: "Puducherry" },

  // --- Uttar Pradesh, Rajasthan & Central India Hubs ---
  { name: "Noida (Sub-dist: Dadri, Dist: Gautam Buddha Nagar), Uttar Pradesh", lat: 28.5355, lng: 77.391, state: "Uttar Pradesh", district: "Gautam Buddha Nagar", subdistrict: "Dadri" },
  { name: "Ghaziabad (Dist: Ghaziabad), Uttar Pradesh", lat: 28.6692, lng: 77.4538, state: "Uttar Pradesh", district: "Ghaziabad" },
  { name: "Lucknow (Sub-dist: Lucknow Sadar, Dist: Lucknow), Uttar Pradesh", lat: 26.8467, lng: 80.9462, state: "Uttar Pradesh", district: "Lucknow", subdistrict: "Lucknow Sadar" },
  { name: "Kanpur (Dist: Kanpur Nagar), Uttar Pradesh", lat: 26.4499, lng: 80.3319, state: "Uttar Pradesh", district: "Kanpur Nagar" },
  { name: "Varanasi (Dist: Varanasi), Uttar Pradesh", lat: 25.3176, lng: 82.9739, state: "Uttar Pradesh", district: "Varanasi" },
  { name: "Prayagraj / Allahabad (Dist: Prayagraj), Uttar Pradesh", lat: 25.4358, lng: 81.8463, state: "Uttar Pradesh", district: "Prayagraj" },
  { name: "Agra (Dist: Agra), Uttar Pradesh", lat: 27.1767, lng: 78.0081, state: "Uttar Pradesh", district: "Agra" },
  { name: "Gorakhpur (Dist: Gorakhpur), Uttar Pradesh", lat: 26.7606, lng: 83.3732, state: "Uttar Pradesh", district: "Gorakhpur" },
  { name: "Meerut (Dist: Meerut), Uttar Pradesh", lat: 28.9845, lng: 77.7064, state: "Uttar Pradesh", district: "Meerut" },
  { name: "Jaipur (Sub-dist: Jaipur Sadar, Dist: Jaipur), Rajasthan", lat: 26.9124, lng: 75.7873, state: "Rajasthan", district: "Jaipur", subdistrict: "Jaipur Sadar" },
  { name: "Jodhpur (Dist: Jodhpur), Rajasthan", lat: 26.2389, lng: 73.0243, state: "Rajasthan", district: "Jodhpur" },
  { name: "Udaipur (Dist: Udaipur), Rajasthan", lat: 24.5854, lng: 73.7125, state: "Rajasthan", district: "Udaipur" },
  { name: "Kota (Dist: Kota), Rajasthan", lat: 25.2138, lng: 75.8648, state: "Rajasthan", district: "Kota" },
  { name: "Ajmer (Dist: Ajmer), Rajasthan", lat: 26.4499, lng: 74.6399, state: "Rajasthan", district: "Ajmer" },

  // --- Island & UT Territory Hubs ---
  { name: "Port Blair (Dist: South Andaman), Andaman and Nicobar Islands", lat: 11.6234, lng: 92.7265, state: "Andaman and Nicobar Islands", district: "South Andaman" },
  { name: "Silvassa (Dist: Dadra and Nagar Haveli), Dadra & Nagar Haveli", lat: 20.2763, lng: 73.0083, state: "Dadra and Nagar Haveli", district: "Dadra and Nagar Haveli" },
  { name: "Daman (Dist: Daman), Daman and Diu", lat: 20.3974, lng: 72.8328, state: "Daman and Diu", district: "Daman" },
  { name: "Kavaratti (Dist: Lakshadweep), Lakshadweep UT", lat: 10.5669, lng: 72.642, state: "Lakshadweep", district: "Lakshadweep" },
];

export const NER_LOCATIONS = INDIA_LOCATIONS.filter((loc) => loc.isNer);
