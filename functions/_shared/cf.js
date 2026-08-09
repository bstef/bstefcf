const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ZONES_ENDPOINT = "https://api.cloudflare.com/client/v4/zones";

export const RANGE_CONFIG = {
  "24h": { ms: 24 * 60 * 60 * 1000, label: "last 24 hours", group: "datetimeHour" },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, label: "last 7 days", group: "date" },
  "30d": { ms: 30 * 24 * 60 * 60 * 1000, label: "last 30 days", group: "date" }
};

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

export function getRange(value) {
  return RANGE_CONFIG[value] || RANGE_CONFIG["24h"];
}

export async function listZones(env) {
  const zones = [];
  let page = 1;

  for (;;) {
    const response = await fetch(`${ZONES_ENDPOINT}?per_page=50&page=${page}&status=active`, {
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        accept: "application/json"
      }
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      const message = payload.errors?.map((error) => error.message).join("; ") || `Cloudflare API returned HTTP ${response.status}`;
      throw new Error(message);
    }

    zones.push(...(payload.result || []));
    const info = payload.result_info;
    if (!info || page >= info.total_pages) break;
    page += 1;
  }

  return zones.map((zone) => ({ id: zone.id, name: zone.name }));
}

export async function queryCloudflare(env, query, variables) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join("; ") || `Cloudflare API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data;
}
