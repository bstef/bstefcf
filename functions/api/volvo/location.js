import { json, getVin, volvoFetch, locationUrl, requireDashboardAuth } from "../../_shared/volvo.js";

export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const payload = await volvoFetch(env, locationUrl(vin));
    const feature = payload?.data;
    const [lon, lat] = feature?.geometry?.coordinates || [];

    if (lat == null || lon == null) {
      return json({ error: "No location reported for this vehicle." }, 404);
    }

    return json({
      lat,
      lon,
      heading: feature.properties?.heading ?? null,
      timestamp: feature.properties?.timestamp ?? null
    });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
