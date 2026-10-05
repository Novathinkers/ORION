// ============================================================================
// Weather service.
//
// Provider: Open-Meteo (open-meteo.com) — free forever, no API key, no card,
// generous rate limits, real forecast data from national weather models.
//
// Used to feed live conditions into the risk engine: current precipitation,
// forecast precipitation probability, wind, and a normalized "condition"
// string that riskEngine.computeRisk() already understands (clear / cloudy /
// fog / rain / heavy_rain / snow / storm).
// ============================================================================

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// WMO weather interpretation codes -> app condition buckets.
// https://open-meteo.com/en/docs (weather code table)
const WEATHER_CODE_MAP = {
  0: "clear", 1: "clear", 2: "cloudy", 3: "cloudy",
  45: "fog", 48: "fog",
  51: "rain", 53: "rain", 55: "rain",
  56: "rain", 57: "rain",
  61: "rain", 63: "rain", 65: "heavy_rain",
  66: "heavy_rain", 67: "heavy_rain",
  71: "snow", 73: "snow", 75: "snow", 77: "snow",
  80: "rain", 81: "heavy_rain", 82: "storm",
  85: "snow", 86: "snow",
  95: "storm", 96: "storm", 99: "storm",
};

// Relative severity used to pick the "worst" sample along a route.
const CONDITION_SEVERITY = {
  clear: 0, cloudy: 1, fog: 2, rain: 3, heavy_rain: 4, snow: 4, storm: 5,
};

export function conditionFromWeatherCode(code) {
  return WEATHER_CODE_MAP[code] ?? "clear";
}

export function conditionLabel(condition) {
  return {
    clear: "Clear", cloudy: "Cloudy", fog: "Fog", rain: "Rain",
    heavy_rain: "Heavy rain", snow: "Snow", storm: "Storm / thunderstorm",
  }[condition] || "Unknown";
}

async function fetchJsonWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function demoWeatherFor(lat, lng) {
  return {
    source: "demo",
    lat, lng,
    condition: "clear",
    rainfall_mm: 0,
    temperatureC: null,
    windKmh: null,
    precipProbability: null,
    weatherCode: 0,
    severity: 0,
  };
}

/** Fetch current + near-term forecast weather for one point via Open-Meteo. */
export async function getPointWeather({ lat, lng }) {
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (!isOnline) return demoWeatherFor(lat, lng);

  try {
    const url =
      `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,precipitation,rain,weathercode,windspeed_10m` +
      `&hourly=precipitation_probability,rain,weathercode` +
      `&forecast_days=2&timezone=auto`;
    const data = await fetchJsonWithTimeout(url);

    const code = data.current?.weathercode ?? 0;
    const condition = conditionFromWeatherCode(code);
    const rainfall_mm = data.current?.rain ?? data.current?.precipitation ?? 0;
    const probs = (data.hourly?.precipitation_probability || []).slice(0, 3);
    const precipProbability = probs.length ? Math.max(...probs) : null;

    return {
      source: "open-meteo",
      lat, lng,
      condition,
      rainfall_mm,
      temperatureC: data.current?.temperature_2m ?? null,
      windKmh: data.current?.windspeed_10m ?? null,
      precipProbability,
      weatherCode: code,
      severity: CONDITION_SEVERITY[condition] ?? 0,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[weatherService] Open-Meteo fetch failed, using DEMO weather:", err.message);
    return demoWeatherFor(lat, lng);
  }
}

/**
 * Sample weather at a handful of points along a route path (start, ~thirds,
 * end) and return the per-point readings plus the single worst-case reading
 * — the one the risk engine should weight the corridor by.
 */
export async function getRouteWeather({ path, sampleCount = 4 }) {
  if (!path || path.length === 0) {
    return { source: "demo", points: [], worst: null };
  }

  const idxs = new Set([0, path.length - 1]);
  for (let i = 1; i < sampleCount - 1; i++) {
    idxs.add(Math.round((i / (sampleCount - 1)) * (path.length - 1)));
  }
  const samplePoints = [...idxs].sort((a, b) => a - b).map((i) => path[i]);

  const points = await Promise.all(samplePoints.map((p) => getPointWeather({ lat: p.lat, lng: p.lng })));
  const worst = points.reduce((acc, p) => (p.severity > (acc?.severity ?? -1) ? p : acc), null);
  const anyReal = points.some((p) => p.source === "open-meteo");

  return { source: anyReal ? "open-meteo" : "demo", points, worst };
}
