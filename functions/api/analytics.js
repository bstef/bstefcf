import { json, getRange, listZones, queryCloudflare } from "../_shared/cf.js";

const CACHE_HIT_STATUSES = new Set(["hit", "stale", "revalidated", "updating"]);

function getFilter({ since, until, hostname }) {
  const filter = {
    datetime_geq: since,
    datetime_leq: until,
    requestSource: "eyeball"
  };

  if (hostname) filter.clientRequestHTTPHost = hostname;
  return filter;
}

function sumTotals(groups) {
  return groups.reduce((total, group) => {
    total.visits += group.sum?.visits || 0;
    total.requests += group.count || 0;
    total.bytes += group.sum?.edgeResponseBytes || 0;
    return total;
  }, { visits: 0, requests: 0, bytes: 0 });
}

function sumCachedBytes(groups) {
  return groups.reduce((total, group) => {
    const status = (group.dimensions?.cacheStatus || "").toLowerCase();
    return CACHE_HIT_STATUSES.has(status) ? total + (group.sum?.edgeResponseBytes || 0) : total;
  }, 0);
}

function normalizeSeries(groups, groupKey) {
  return groups
    .map((group) => ({
      time: group.dimensions?.[groupKey],
      visits: group.sum?.visits || 0,
      requests: group.count || 0,
      bytes: group.sum?.edgeResponseBytes || 0
    }))
    .filter((point) => point.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function normalizeRows(groups, labelGetter) {
  return groups
    .map((group) => ({
      label: labelGetter(group),
      requests: group.count || 0,
      bytes: group.sum?.edgeResponseBytes || 0
    }))
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
              edgeResponseBytes
            }
          }
          timeseries: httpRequestsAdaptiveGroups(limit: 100, filter: $filter) {
            count
            dimensions {
              ${groupKey}
            }
            sum {
              visits
              edgeResponseBytes
            }
          }
          topPaths: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [sum_edgeResponseBytes_DESC]) {
            count
            dimensions {
              clientRequestPath
            }
            sum {
              edgeResponseBytes
            }
          }
          countries: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [count_DESC]) {
            count
            dimensions {
              clientCountryName
            }
            sum {
              edgeResponseBytes
            }
          }
          statuses: httpRequestsAdaptiveGroups(limit: 12, filter: $filter, orderBy: [count_DESC]) {
            count
            dimensions {
              edgeResponseStatus
            }
            sum {
              edgeResponseBytes
            }
          }
          cacheBreakdown: httpRequestsAdaptiveGroups(limit: 20, filter: $filter) {
            dimensions {
              cacheStatus
            }
            sum {
              edgeResponseBytes
            }
          }
        }
      }
    }
  `;
}

function mergeSeries(seriesLists) {
  const byTime = new Map();
  for (const series of seriesLists) {
    for (const point of series) {
      const existing = byTime.get(point.time) || { time: point.time, visits: 0, requests: 0, bytes: 0 };
      existing.visits += point.visits;
      existing.requests += point.requests;
      existing.bytes += point.bytes;
      byTime.set(point.time, existing);
    }
  }
  return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function mergeRows(rowLists) {
  const byLabel = new Map();
  for (const rows of rowLists) {
    for (const row of rows) {
      const existing = byLabel.get(row.label) || { label: row.label, requests: 0, bytes: 0 };
      existing.requests += row.requests || 0;
      existing.bytes += row.bytes || 0;
      byLabel.set(row.label, existing);
    }
  }
  return [...byLabel.values()].sort((a, b) => (b.requests || b.bytes || 0) - (a.requests || a.bytes || 0));
}

async function fetchZone(env, zoneTag, groupKey, filter) {
  const data = await queryCloudflare(env, buildQuery(groupKey), { zoneTag, filter });
  const zone = data.viewer?.zones?.[0];
  if (!zone) return null;

  const totals = sumTotals(zone.totals || []);
  totals.cachedBytes = sumCachedBytes(zone.cacheBreakdown || []);

  return {
    totals,
    timeseries: normalizeSeries(zone.timeseries || [], groupKey),
    paths: normalizeRows(zone.topPaths || [], (group) => group.dimensions?.clientRequestPath || "/"),
    countries: normalizeRows(zone.countries || [], (group) => group.dimensions?.clientCountryName || "Unknown"),
    statuses: normalizeRows(zone.statuses || [], (group) => String(group.dimensions?.edgeResponseStatus || "Unknown"))
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    return json({ error: "Missing CLOUDFLARE_API_TOKEN secret on the Pages project or Worker." }, 500);
  }

  const url = new URL(request.url);
  const range = getRange(url.searchParams.get("range"));
  const zoneTagParam = url.searchParams.get("zoneTag") || "";
  const zoneNameParam = url.searchParams.get("zoneName") || "";
  const hostname = url.searchParams.get("hostname") || env.DEFAULT_HOSTNAME || "";

  const until = new Date();
  const since = new Date(until.getTime() - range.ms);
  const filter = getFilter({ since: since.toISOString(), until: until.toISOString(), hostname });

  try {
    const explicitTag = zoneTagParam || env.DEFAULT_ZONE_TAG || "";
    const targets = explicitTag
      ? [{ id: explicitTag, name: zoneNameParam || null }]
      : await listZones(env);

    if (!targets.length) {
      return json({ error: "No zones found for this account/token." }, 404);
    }

    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          const zoneData = await fetchZone(env, target.id, range.group, filter);
          return zoneData ? { ...target, ...zoneData } : { ...target, error: "No data returned for this zone." };
        } catch (error) {
          return { ...target, error: error.message };
        }
      })
    );

    const valid = results.filter((result) => !result.error);
    const failed = results.filter((result) => result.error);

    if (!valid.length) {
      return json({ error: failed[0]?.error || "No zone data was returned. Check the Zone ID and API token permissions." }, 404);
    }

    const totals = valid.reduce((acc, zone) => {
      acc.visits += zone.totals.visits;
      acc.requests += zone.totals.requests;
      acc.bytes += zone.totals.bytes;
      acc.cachedBytes += zone.totals.cachedBytes;
      return acc;
    }, { visits: 0, requests: 0, bytes: 0, cachedBytes: 0 });
    totals.requestsPerVisit = totals.visits ? totals.requests / totals.visits : 0;
    totals.bytesPerRequest = totals.requests ? totals.bytes / totals.requests : 0;

    const statuses = mergeRows(valid.map((zone) => zone.statuses));
    const errorRequests = statuses
      .filter((row) => Number(row.label) >= 400)
      .reduce((sum, row) => sum + (row.requests || 0), 0);
    totals.errorRate = totals.requests ? errorRequests / totals.requests : 0;

    const label = explicitTag
      ? (hostname || valid[0].name || "Selected domain")
      : `All domains (${valid.length})`;

    return json({
      generatedAt: new Date().toISOString(),
      hostname: label,
      rangeLabel: range.label,
      totals,
      timeseries: mergeSeries(valid.map((zone) => zone.timeseries)),
      paths: mergeRows(valid.map((zone) => zone.paths)),
      countries: mergeRows(valid.map((zone) => zone.countries)),
      statuses,
      domains: valid.length > 1
        ? valid
            .map((zone) => ({ label: zone.name || zone.id, requests: zone.totals.requests, bytes: zone.totals.bytes }))
            .sort((a, b) => b.requests - a.requests)
        : undefined,
      failedZones: failed.length ? failed.map((zone) => ({ label: zone.name || zone.id, error: zone.error })) : undefined
    });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
