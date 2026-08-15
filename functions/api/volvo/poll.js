import { json, getVin, volvoFetch, locationUrl, vehicleUrl, haversineKm, requireEnv } from "../../_shared/volvo.js";

// How far the car has to move between polls before we call it "driving"
// rather than GPS jitter while parked.
const MOVE_THRESHOLD_KM = 0.06;
// How long it has to sit still before an in-progress trip is closed out.
const STATIONARY_CLOSE_SEC = 15 * 60;

async function readOdometerKm(env, vin) {
  try {
    const payload = await volvoFetch(env, vehicleUrl(vin, "/odometer"));
    const value = payload?.data?.odometer?.value;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireEnv(env, ["POLL_SECRET"]);
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.POLL_SECRET}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const vin = getVin(env);
    const locationPayload = await volvoFetch(env, locationUrl(vin));
    const feature = locationPayload?.data;
    const [lon, lat] = feature?.geometry?.coordinates || [];
    if (lat == null || lon == null) {
      return json({ error: "No location reported for this vehicle." }, 404);
    }
    const heading = feature.properties?.heading ?? null;
    const odometerKm = await readOdometerKm(env, vin);
    const now = Math.floor(Date.now() / 1000);

    const last = await env.VOLVO_DB.prepare(
      "SELECT * FROM location_pings WHERE vin = ? ORDER BY recorded_at DESC LIMIT 1"
    )
      .bind(vin)
      .first();

    await env.VOLVO_DB.prepare(
      "INSERT INTO location_pings (vin, lat, lon, heading, odometer_km, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(vin, lat, lon, heading, odometerKm, now)
      .run();

    const distanceFromLast = last ? haversineKm(last.lat, last.lon, lat, lon) : 0;
    const moving = distanceFromLast >= MOVE_THRESHOLD_KM;

    const active = await env.VOLVO_DB.prepare(
      "SELECT * FROM trips WHERE vin = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1"
    )
      .bind(vin)
      .first();

    let action = "idle";

    if (active) {
      if (moving) {
        const path = JSON.parse(active.path_json || "[]");
        path.push([lat, lon, now]);
        await env.VOLVO_DB.prepare(
          `UPDATE trips SET last_point_at = ?, end_lat = ?, end_lon = ?, end_odometer_km = ?,
             distance_km = distance_km + ?, path_json = ? WHERE id = ?`
        )
          .bind(now, lat, lon, odometerKm, distanceFromLast, JSON.stringify(path), active.id)
          .run();
        action = "trip-continued";
      } else if (now - active.last_point_at > STATIONARY_CLOSE_SEC) {
        await env.VOLVO_DB.prepare("UPDATE trips SET status = 'completed', end_time = ? WHERE id = ?")
          .bind(active.last_point_at, active.id)
          .run();
        action = "trip-closed";
      }
    } else if (moving && last) {
      const path = [
        [last.lat, last.lon, last.recorded_at],
        [lat, lon, now]
      ];
      await env.VOLVO_DB.prepare(
        `INSERT INTO trips
           (vin, status, start_time, end_time, last_point_at, start_lat, start_lon, end_lat, end_lon,
            start_odometer_km, end_odometer_km, distance_km, path_json)
         VALUES (?, 'active', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          vin,
          last.recorded_at,
          now,
          last.lat,
          last.lon,
          lat,
          lon,
          last.odometer_km ?? odometerKm,
          odometerKm,
          distanceFromLast,
          JSON.stringify(path)
        )
        .run();
      action = "trip-started";
    }

    return json({ action, lat, lon, distanceFromLastKm: Math.round(distanceFromLast * 1000) / 1000 });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
