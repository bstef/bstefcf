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

// Returns a valid access token, refreshing (and persisting the rotated
// refresh token) whenever the cached one is missing or about to expire.
// The very first call falls back to the long-lived VOLVO_REFRESH_TOKEN
// secret to bootstrap D1 before any row exists.
export async function getAccessToken(env) {
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
