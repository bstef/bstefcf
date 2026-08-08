const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const RANGE_CONFIG = {
  "24h": { ms: 24 * 60 * 60 * 1000, label: "last 24 hours", group: "datetimeHour" },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, label: "last 7 days", group: "datetimeDay" },
  "30d": { ms: 30 * 24 * 60 * 60 * 1000, label: "last 30 days", group: "datetimeDay" }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function getRange(value) {
  return RANGE_CONFIG[value] || RANGE_CONFIG["24h"];
}

function getFilter({ since, until, hostname }) {
  const filter = {
    datetime_geq: since,
    datetime_leq: until,
    requestSource: "eyeball"
  };

  if (hostname) filter.clientRequestHTTPHost = hostname;
  return filter;
}

function sumGroups(groups) {
  return groups.reduce((total, group) => {
    const sum = group.sum || {};
    total.visits += sum.visits || 0;
    total.requests += sum.requests || group.count || 0;
    total.bytes += sum.edgeResponseBytes || 0;
    total.cachedBytes += sum.cachedBytes || 0;
    total.threats += sum.threats || 0;
    return total;
  }, { visits: 0, requests: 0, bytes: 0, cachedBytes: 0, threats: 0 });
}

function normalizeSeries(groups, groupKey) {
  return groups
    .map((group) => ({
      time: group.dimensions?.[groupKey],
      visits: group.sum?.visits || 0,
      requests: group.sum?.requests || group.count || 0,
      bytes: group.sum?.edgeResponseBytes || 0,
      cachedBytes: group.sum?.cachedBytes || 0,
      threats: group.sum?.threats || 0
    }))
    .filter((point) => point.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function normalizeRows(groups, labelGetter, valueGetter) {
  return groups
    .map((group) => ({ label: labelGetter(group), ...valueGetter(group) }))
    .filter((row) => row.label)
    .sort((a, b) => (b.requests || b.bytes || 0) - (a.requests || a.bytes || 0));
}

function buildQuery(groupKey) {
  return `
    query DomainDashboard($zoneTag: string, $filter: filter) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          totals: httpRequestsAdaptiveGroups(limit: 1, filter: $filter) {
            count
            sum {
              visits
              requests
              edgeResponseBytes
              cachedBytes
              threats
            }
          }
          timeseries: httpRequestsAdaptiveGroups(limit: 100, filter: $filter) {
            count
            dimensions {
              ${groupKey}
            }
            sum {
              visits
              requests
              edgeResponseBytes
              cachedBytes
              threats
            }
          }
          topPaths: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [sum_edgeResponseBytes_DESC]) {
            count
            dimensions {
              clientRequestPath
            }
            sum {
              visits
              requests
              edgeResponseBytes
            }
          }
          countries: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [sum_requests_DESC]) {
            count
            dimensions {
              clientCountryName
            }
            sum {
              requests
              edgeResponseBytes
            }
          }
          statuses: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [sum_requests_DESC]) {
            count
            dimensions {
              edgeResponseStatus
            }
            sum {
              requests
              edgeResponseBytes
            }
          }
        }
      }
    }
  `;
}

async function queryCloudflare(env, query, variables) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "accept": "application/json",
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

export async function onRequestGet({ request, env }) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    return json({ error: "Missing CLOUDFLARE_API_TOKEN secret on the Pages project or Worker." }, 500);
  }

  const url = new URL(request.url);
  const range = getRange(url.searchParams.get("range"));
  const zoneTag = url.searchParams.get("zoneTag") || env.DEFAULT_ZONE_TAG;
  const hostname = url.searchParams.get("hostname") || env.DEFAULT_HOSTNAME || "";

  if (!zoneTag) {
    return json({ error: "Missing zoneTag. Enter a Zone ID in the dashboard or set DEFAULT_ZONE_TAG." }, 400);
  }

  const until = new Date();
  const since = new Date(until.getTime() - range.ms);
  const filter = getFilter({
    since: since.toISOString(),
    until: until.toISOString(),
    hostname
  });

  try {
    const data = await queryCloudflare(env, buildQuery(range.group), { zoneTag, filter });
    const zone = data.viewer?.zones?.[0];
    if (!zone) return json({ error: "No zone was returned. Check the Zone ID and API token permissions." }, 404);

    const totals = sumGroups(zone.totals || []);
    totals.requestsPerVisit = totals.visits ? totals.requests / totals.visits : 0;
    totals.bytesPerRequest = totals.requests ? totals.bytes / totals.requests : 0;

    return json({
      generatedAt: new Date().toISOString(),
      hostname: hostname || "All hostnames",
      rangeLabel: range.label,
      totals,
      timeseries: normalizeSeries(zone.timeseries || [], range.group),
      paths: normalizeRows(
        zone.topPaths || [],
        (group) => group.dimensions?.clientRequestPath || "/",
        (group) => ({
          requests: group.sum?.requests || group.count || 0,
          bytes: group.sum?.edgeResponseBytes || 0
        })
      ),
      countries: normalizeRows(
        zone.countries || [],
        (group) => group.dimensions?.clientCountryName || "Unknown",
        (group) => ({
          requests: group.sum?.requests || group.count || 0,
          bytes: group.sum?.edgeResponseBytes || 0
        })
      ),
      statuses: normalizeRows(
        zone.statuses || [],
        (group) => String(group.dimensions?.edgeResponseStatus || "Unknown"),
        (group) => ({
          requests: group.sum?.requests || group.count || 0,
          bytes: group.sum?.edgeResponseBytes || 0
        })
      )
    });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
