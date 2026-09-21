// Serves OpenStreetMap geometry for the Magic Kingdom to the shade map page.
// Cached at the edge because park geometry changes rarely and Overpass is rate limited.

const MK_BBOX = "28.4140,-81.5870,28.4240,-81.5750";
const CACHE_TTL_SECONDS = 604800; // 7 days
const SNAPSHOT_TTL_SECONDS = 31536000; // 1 year

// Public Overpass instances rate limit per IP, and Cloudflare egress IPs are shared
// with other tenants, so any single endpoint can return 429 or be down entirely.
// Every instance is tried before giving up.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];
const ENDPOINT_TIMEOUT_MS = 20000;

const QUERY = `[out:json][timeout:60];
(
  node["tourism"="attraction"](${MK_BBOX});
  way["tourism"="attraction"](${MK_BBOX});
  way["building"](${MK_BBOX});
);
out geom tags;`;

const FEET_PER_METRE = 0.3048;
const METRES_PER_LEVEL = 3.2;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// OSM `height` is metres by default but feet notation ("40'" / "40 ft") is common.
function parseHeightTag(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  const feetMatch = value.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/i);
  if (feetMatch) return parseFloat(feetMatch[1]) * FEET_PER_METRE;
  const metreMatch = value.match(/^(\d+(?:\.\d+)?)\s*(?:m|metres|meters)?$/i);
  if (metreMatch) return parseFloat(metreMatch[1]);
  return null;
}

function resolveHeight(tags) {
  const tagged = parseHeightTag(tags.height) || parseHeightTag(tags["building:height"]);
  if (tagged && tagged > 0) return { height: tagged, source: "tag" };

  const levels = parseFloat(tags["building:levels"]);
  if (!Number.isNaN(levels) && levels > 0) {
    return { height: levels * METRES_PER_LEVEL, source: "levels" };
  }

  return { height: null, source: "unknown" };
}

function centroidOf(geometry) {
  let lat = 0;
  let lon = 0;
  for (const point of geometry) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / geometry.length, lon: lon / geometry.length };
}

function normalize(elements) {
  const attractions = [];
  const buildings = [];

  for (const element of elements) {
    const tags = element.tags || {};

    // A way can be both an attraction and a building, so these are not exclusive:
    // show buildings still need their footprint for the shadow layer.
    if (tags.tourism === "attraction" && tags.name) {
      if (element.type === "node" && typeof element.lat === "number") {
        attractions.push({ name: tags.name, lat: round6(element.lat), lon: round6(element.lon) });
      } else if (element.geometry && element.geometry.length) {
        const center = centroidOf(element.geometry);
        attractions.push({ name: tags.name, lat: round6(center.lat), lon: round6(center.lon) });
      }
    }

    if (tags.building && element.geometry && element.geometry.length >= 3) {
      const { height, source } = resolveHeight(tags);
      buildings.push({
        name: tags.name || "",
        height,
        heightSource: source,
        coords: element.geometry.map((point) => [round6(point.lat), round6(point.lon)])
      });
    }
  }

  return { attractions, buildings };
}

async function queryOverpass() {
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: QUERY }),
        signal: controller.signal
      });

      if (!response.ok) {
        errors.push(`${new URL(endpoint).host} responded ${response.status}`);
        continue;
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.elements)) {
        errors.push(`${new URL(endpoint).host} returned an unexpected payload`);
        continue;
      }

      return payload.elements;
    } catch (error) {
      const reason = error.name === "AbortError" ? `timed out after ${ENDPOINT_TIMEOUT_MS}ms` : error.message;
      errors.push(`${new URL(endpoint).host} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(errors.join("; ") || "No Overpass endpoint reachable");
}

export async function onRequestGet(context) {
  const { request, waitUntil } = context;
  const cache = caches.default;
  // The dataset is fixed, so the key ignores the query string: otherwise any
  // ?bust=… link would miss the cache and re-run the Overpass query.
  const requestUrl = new URL(request.url);
  const cacheKey = new Request(requestUrl.origin + requestUrl.pathname, { method: "GET" });

  // Every Overpass instance can be down or rate limiting at once, so the last good
  // payload is kept for a year under its own key and served if a refresh fails.
  const snapshotKey = new Request(`${requestUrl.origin}${requestUrl.pathname}?snapshot=last-good`, {
    method: "GET"
  });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let elements;
  try {
    elements = await queryOverpass();
  } catch (error) {
    const snapshot = await cache.match(snapshotKey);
    if (snapshot) {
      const headers = new Headers(snapshot.headers);
      headers.set("cache-control", "public, max-age=300");
      headers.set("x-mk-geo-source", "snapshot");
      return new Response(snapshot.body, { status: 200, headers });
    }
    return json(
      {
        error: "OpenStreetMap data is temporarily unavailable.",
        detail: error.message
      },
      502,
      { "cache-control": "no-store" }
    );
  }

  const { attractions, buildings } = normalize(elements);
  const body = JSON.stringify({
    source: "OpenStreetMap contributors (ODbL)",
    bbox: MK_BBOX,
    fetchedAt: new Date().toISOString(),
    attractions,
    buildings
  });

  const response = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=3600, s-maxage=${CACHE_TTL_SECONDS}`
    }
  });

  waitUntil(cache.put(cacheKey, response.clone()));
  waitUntil(
    cache.put(
      snapshotKey,
      new Response(body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${SNAPSHOT_TTL_SECONDS}`
        }
      })
    )
  );
  return response;
}
