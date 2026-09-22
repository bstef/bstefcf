// Weather and active NWS alerts for the Magic Kingdom, for the date the shade map
// has selected. Both upstreams are keyless.

const MK_LAT = 28.416;
const MK_LON = -81.5812;
const MK_TZ = "America/New_York";

// Open-Meteo's forecast endpoint covers recent past days as well as the forecast
// window. Outside this range there is no data to show, and guessing would be worse
// than saying so.
const PAST_DAYS_LIMIT = 90;
const FUTURE_DAYS_LIMIT = 16;

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ALERTS_URL = "https://api.weather.gov/alerts/active";

// NWS asks that clients identify themselves.
const NWS_USER_AGENT = "(bstef.pages.dev, https://github.com/bstef/bstefcf)";

const WEATHER_CACHE_SECONDS = 900; // 15 minutes
const ALERT_CACHE_SECONDS = 120; // alerts are safety information, so barely cached
const UPSTREAM_TIMEOUT_MS = 12000;

// WMO weather interpretation codes.
const WEATHER_CODES = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Severe thunderstorms with hail"
};

const THUNDERSTORM_CODES = [95, 96, 99];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function describeCode(code) {
  if (code === null || code === undefined) return "";
  return WEATHER_CODES[code] || "";
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return await response.json();
  } catch (error) {
    const reason = error.name === "AbortError" ? "timed out" : error.message;
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }
}

function todayInPark() {
  return new Date().toLocaleDateString("en-CA", { timeZone: MK_TZ });
}

function daysBetween(fromISO, toISO) {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function average(values) {
  const usable = values.filter((v) => typeof v === "number");
  if (!usable.length) return null;
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

function maxOf(values) {
  const usable = values.filter((v) => typeof v === "number");
  if (!usable.length) return null;
  return Math.max(...usable);
}

function buildForecastUrl(date) {
  const params = new URLSearchParams({
    latitude: String(MK_LAT),
    longitude: String(MK_LON),
    timezone: MK_TZ,
    start_date: date,
    end_date: date,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,cloud_cover,weather_code,uv_index"
  });
  return `${FORECAST_URL}?${params.toString()}`;
}

// Daily aggregates are derived from the hourly series rather than requested as
// daily variables, so the payload does not depend on aggregation names that vary
// between Open-Meteo models.
function normalizeWeather(payload) {
  const daily = payload.daily || {};
  const hourly = payload.hourly || {};
  const times = hourly.time || [];

  const hours = times.map((time, i) => ({
    time,
    hour: Number(time.slice(11, 13)),
    temperature: hourly.temperature_2m ? hourly.temperature_2m[i] : null,
    apparentTemperature: hourly.apparent_temperature ? hourly.apparent_temperature[i] : null,
    precipitationProbability: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
    cloudCover: hourly.cloud_cover ? hourly.cloud_cover[i] : null,
    uvIndex: hourly.uv_index ? hourly.uv_index[i] : null,
    weatherCode: hourly.weather_code ? hourly.weather_code[i] : null
  }));

  const stormHours = hours
    .filter((h) => THUNDERSTORM_CODES.indexOf(h.weatherCode) !== -1)
    .map((h) => h.hour);

  return {
    high: daily.temperature_2m_max ? daily.temperature_2m_max[0] : null,
    low: daily.temperature_2m_min ? daily.temperature_2m_min[0] : null,
    precipitationSum: daily.precipitation_sum ? daily.precipitation_sum[0] : null,
    windSpeedMax: daily.wind_speed_10m_max ? daily.wind_speed_10m_max[0] : null,
    weatherCode: daily.weather_code ? daily.weather_code[0] : null,
    summary: describeCode(daily.weather_code ? daily.weather_code[0] : null),
    feelsLikeMax: maxOf(hours.map((h) => h.apparentTemperature)),
    cloudCoverMean: average(hours.map((h) => h.cloudCover)),
    precipitationChanceMax: maxOf(hours.map((h) => h.precipitationProbability)),
    uvIndexMax: maxOf(hours.map((h) => h.uvIndex)),
    stormHours,
    hours
  };
}

// An alert matters for the selected day when its active window overlaps that day,
// so a watch issued today for Thursday shows up when Thursday is selected.
function alertsForDate(features, date) {
  const dayStart = Date.parse(`${date}T00:00:00Z`) - 24 * 3600000;
  const dayEnd = Date.parse(`${date}T00:00:00Z`) + 48 * 3600000;

  return features
    .map((feature) => feature.properties || {})
    .filter((props) => {
      const startsAt = Date.parse(props.onset || props.effective || props.sent || "");
      const endsAt = Date.parse(props.ends || props.expires || "");
      if (Number.isNaN(startsAt) && Number.isNaN(endsAt)) return true;
      const from = Number.isNaN(startsAt) ? dayStart : startsAt;
      const to = Number.isNaN(endsAt) ? dayEnd : endsAt;
      return from <= dayEnd && to >= dayStart;
    })
    .map((props) => ({
      event: props.event || "Weather alert",
      headline: props.headline || "",
      description: props.description || "",
      instruction: props.instruction || "",
      severity: props.severity || "Unknown",
      urgency: props.urgency || "",
      certainty: props.certainty || "",
      areaDesc: props.areaDesc || "",
      onset: props.onset || props.effective || "",
      ends: props.ends || props.expires || ""
    }));
}

export async function onRequestGet(context) {
  const { request } = context;
  const requestUrl = new URL(request.url);
  const date = requestUrl.searchParams.get("date") || todayInPark();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "A date in YYYY-MM-DD form is required." }, 400, { "cache-control": "no-store" });
  }

  const offset = daysBetween(todayInPark(), date);
  const outOfRange = offset < -PAST_DAYS_LIMIT || offset > FUTURE_DAYS_LIMIT;

  const results = { date, weather: null, weatherError: null, alerts: [], alertsError: null };

  if (outOfRange) {
    results.weatherError =
      offset > 0
        ? `No forecast exists this far ahead — weather covers about ${FUTURE_DAYS_LIMIT} days out.`
        : `No observations available this far back — weather covers about ${PAST_DAYS_LIMIT} days of history.`;
  } else {
    try {
      results.weather = normalizeWeather(await fetchJson(buildForecastUrl(date)));
    } catch (error) {
      results.weatherError = `Could not reach the weather service (${error.message}).`;
    }
  }

  try {
    const alertPayload = await fetchJson(`${ALERTS_URL}?point=${MK_LAT},${MK_LON}`, {
      headers: { "user-agent": NWS_USER_AGENT, accept: "application/geo+json" }
    });
    results.alerts = alertsForDate(alertPayload.features || [], date);
  } catch (error) {
    results.alertsError = `Could not reach the National Weather Service (${error.message}).`;
  }

  // Alerts go stale in a way that matters, so the whole payload follows their TTL.
  const maxAge = results.alerts.length ? ALERT_CACHE_SECONDS : Math.min(WEATHER_CACHE_SECONDS, 600);
  return json(results, 200, { "cache-control": `public, max-age=60, s-maxage=${maxAge}` });
}
