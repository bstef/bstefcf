const TOKEN_URL = "https://volvoid.eu.volvocars.com/as/token.oauth2";
const CV_BASE = "https://api.volvocars.com/connected-vehicle/v2/vehicles";
const LOCATION_BASE = "https://api.volvocars.com/location/v1/vehicles";
const ENERGY_BASE = "https://api.volvocars.com/energy/v2/vehicles";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required secret(s) on the Pages project: ${missing.join(", ")}`);
  }
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

// Every user-facing /api/volvo/* route (everything except poll.js, which has
// its own POLL_SECRET for the unattended cron caller) requires this shared
// secret, so an unauthenticated visitor to the public Pages deployment can't
// read vehicle/location data or send remote commands. This is a minimum-bar
// app-level gate, not a substitute for putting Cloudflare Access in front of
// /volvo.html and /api/volvo/* for real caller authentication — see README.
export function requireDashboardAuth(request, env) {
  requireEnv(env, ["DASHBOARD_TOKEN"]);
  const auth = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.DASHBOARD_TOKEN}`;
  if (!timingSafeEqual(auth, expected)) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
}

async function requestToken(env, params) {
  const basic = btoa(`${env.VOLVO_CLIENT_ID}:${env.VOLVO_CLIENT_SECRET}`);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.error || `Token request failed with HTTP ${response.status}`;
    throw new Error(`Volvo token exchange failed: ${message}`);
  }
  return payload;
}

async function loadStoredToken(env) {
  const row = await env.VOLVO_DB.prepare("SELECT * FROM oauth_tokens WHERE id = 1").first();
  return row || null;
}

async function saveToken(env, { access_token, refresh_token, expires_in }) {
  const expiresAt = Math.floor(Date.now() / 1000) + (Number(expires_in) || 1800);
  const updatedAt = Math.floor(Date.now() / 1000);
  await env.VOLVO_DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  )
    .bind(access_token, refresh_token, expiresAt, updatedAt)
    .run();
  return { access_token, refresh_token, expires_at: expiresAt };
}

// Module-level single-flight guard. Volvo rotates the refresh token on every
// use, so if the many resource fetches vehicle.js fires in parallel each
// independently noticed the cached token was stale and refreshed on their
// own, only the first exchange would succeed — the rest would submit an
// already-consumed refresh_token and get invalid_grant back. Routing every
// call through this one in-flight promise makes them share a single
// exchange instead. The check-and-set below is synchronous (no `await`
// before it), so it's race-free even when many calls are kicked off in the
// same tick via Promise.all — whichever runs first claims the slot before
// any other call gets a chance to check it.
let tokenPromise = null;

async function fetchOrRefreshToken(env) {
  requireEnv(env, ["VOLVO_CLIENT_ID", "VOLVO_CLIENT_SECRET", "VOLVO_API_KEY"]);
  if (!env.VOLVO_DB) {
    throw new Error("Missing VOLVO_DB — bind a D1 database named VOLVO_DB to this Pages project.");
  }

  const stored = await loadStoredToken(env);
  const now = Math.floor(Date.now() / 1000);

  if (stored && stored.expires_at - now > 60) {
    return stored.access_token;
  }

  const refreshToken = stored?.refresh_token || env.VOLVO_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "No Volvo refresh token available. Set VOLVO_REFRESH_TOKEN (from the OAuth authorization-code exchange) to bootstrap."
    );
  }

  const payload = await requestToken(env, { grant_type: "refresh_token", refresh_token: refreshToken });
  const saved = await saveToken(env, payload);
  return saved.access_token;
}

// Returns a valid access token, refreshing (and persisting the rotated
// refresh token) whenever the cached one is missing or about to expire.
// The very first call falls back to the long-lived VOLVO_REFRESH_TOKEN
// secret to bootstrap D1 before any row exists. Concurrent callers within
// the same Worker invocation share one exchange — see the single-flight
// note above. This only guards one isolate; two truly simultaneous
// requests landing on different isolates can still both refresh, but
// that's rare and self-healing (the loser's next call just re-reads D1).
export function getAccessToken(env) {
  if (!tokenPromise) {
    tokenPromise = fetchOrRefreshToken(env).finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

export async function volvoFetch(env, url, options = {}) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "vcc-api-key": env.VOLVO_API_KEY,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function vehicleUrl(vin, path = "") {
  return `${CV_BASE}/${vin}${path}`;
}

export function locationUrl(vin) {
  return `${LOCATION_BASE}/${vin}/location`;
}

export function energyUrl(vin, path = "") {
  return `${ENERGY_BASE}/${vin}${path}`;
}

export function getVin(env) {
  if (!env.VOLVO_VIN) throw new Error("Missing VOLVO_VIN secret on the Pages project.");
  return env.VOLVO_VIN;
}

// Fetches a Connected Vehicle API resource, treating "not supported for
// this vehicle" (404/501) as an absent-but-not-fatal result rather than
// failing the whole aggregate response.
export async function tryFetch(env, url) {
  try {
    const payload = await volvoFetch(env, url);
    return { ok: true, data: payload?.data ?? payload };
  } catch (error) {
    return { ok: false, error: error.message, status: error.status };
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
