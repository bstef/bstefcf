import { json, getVin, requireDashboardAuth } from "../../_shared/volvo.js";

function toTrip(row, includePath) {
  const trip = {
    id: row.id,
    status: row.status,
    startTime: new Date(row.start_time * 1000).toISOString(),
    endTime: row.end_time ? new Date(row.end_time * 1000).toISOString() : null,
    durationMin: row.end_time ? Math.round((row.end_time - row.start_time) / 60) : null,
    start: { lat: row.start_lat, lon: row.start_lon },
    end: { lat: row.end_lat, lon: row.end_lon },
    distanceKm: Math.round((row.distance_km || 0) * 10) / 10,
    startOdometerKm: row.start_odometer_km,
    endOdometerKm: row.end_odometer_km
  };
  if (includePath) {
    trip.path = JSON.parse(row.path_json || "[]");
  }
  return trip;
}

export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const row = await env.VOLVO_DB.prepare("SELECT * FROM trips WHERE id = ? AND vin = ?").bind(id, vin).first();
      if (!row) return json({ error: "Trip not found." }, 404);
      return json({ trip: toTrip(row, true) });
    }

    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const { results } = await env.VOLVO_DB.prepare(
      "SELECT * FROM trips WHERE vin = ? AND start_time >= ? ORDER BY start_time DESC LIMIT 200"
    )
      .bind(vin, since)
      .all();

    const trips = (results || []).map((row) => toTrip(row, false));
    const totalDistanceKm = Math.round(trips.reduce((sum, trip) => sum + trip.distanceKm, 0) * 10) / 10;

    return json({ trips, totalDistanceKm, count: trips.length });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
