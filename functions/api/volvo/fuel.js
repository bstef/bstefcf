import { json, getVin, requireDashboardAuth } from "../../_shared/volvo.js";

const KM_TO_MI = 0.621371;

function withDerived(rows) {
  // Standard full-to-full MPG: gallons accumulate across any partial fills
  // in between, and only resolve into an MPG figure once a full fill closes
  // the interval (a partial doesn't top off the tank, so the distance since
  // the last full fill doesn't correspond to "gallons used" until then).
  const sorted = [...rows].sort((a, b) => a.odometer_km - b.odometer_km);
  let lastFullOdoKm = null;
  let pendingGallons = 0;
  const mpgById = new Map();

  for (const row of sorted) {
    pendingGallons += row.gallons;
    if (!row.is_partial) {
      if (lastFullOdoKm != null && pendingGallons > 0) {
        const milesDelta = (row.odometer_km - lastFullOdoKm) * KM_TO_MI;
        mpgById.set(row.id, Math.round((milesDelta / pendingGallons) * 10) / 10);
      }
      lastFullOdoKm = row.odometer_km;
      pendingGallons = 0;
    }
  }

  return rows.map((row) => ({
    id: row.id,
    filledAt: new Date(row.filled_at * 1000).toISOString(),
    odometerKm: row.odometer_km,
    gallons: row.gallons,
    pricePerGallon: row.price_per_gallon,
    totalCost: row.total_cost,
    isPartial: !!row.is_partial,
    station: row.station,
    notes: row.notes,
    source: row.source,
    mpg: mpgById.get(row.id) ?? null
  }));
}

export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 365, 1), 3650);
    const since = Math.floor(Date.now() / 1000) - days * 86400;

    const { results } = await env.VOLVO_DB.prepare(
      "SELECT * FROM fuel_ups WHERE vin = ? AND filled_at >= ? ORDER BY odometer_km ASC"
    )
      .bind(vin, since)
      .all();

    const fillups = withDerived(results || []).reverse();
    const withCost = fillups.filter((f) => f.totalCost != null);
    const withMpg = fillups.filter((f) => f.mpg != null);

    const stats = {
      count: fillups.length,
      totalGallons: Math.round(fillups.reduce((s, f) => s + f.gallons, 0) * 100) / 100,
      totalCost: Math.round(withCost.reduce((s, f) => s + f.totalCost, 0) * 100) / 100,
      avgMpg: withMpg.length ? Math.round((withMpg.reduce((s, f) => s + f.mpg, 0) / withMpg.length) * 10) / 10 : null,
      avgPricePerGallon: withCost.length
        ? Math.round((withCost.reduce((s, f) => s + f.totalCost, 0) / withCost.reduce((s, f) => s + f.gallons, 0)) * 1000) / 1000
        : null
    };

    return json({ fillups, stats });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const body = await request.json().catch(() => ({}));

    const odometerKm = Number(body.odometerKm);
    const gallons = Number(body.gallons);
    if (!Number.isFinite(odometerKm) || odometerKm <= 0) return json({ error: "odometerKm must be a positive number." }, 400);
    if (!Number.isFinite(gallons) || gallons <= 0) return json({ error: "gallons must be a positive number." }, 400);

    let pricePerGallon = body.pricePerGallon != null ? Number(body.pricePerGallon) : null;
    let totalCost = body.totalCost != null ? Number(body.totalCost) : null;
    if (totalCost == null && pricePerGallon != null) totalCost = Math.round(pricePerGallon * gallons * 100) / 100;
    if (pricePerGallon == null && totalCost != null) pricePerGallon = Math.round((totalCost / gallons) * 1000) / 1000;

    const filledAt = body.filledAt ? Math.floor(new Date(body.filledAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
    if (!Number.isFinite(filledAt)) return json({ error: "filledAt is not a valid date." }, 400);

    await env.VOLVO_DB.prepare(
      `INSERT OR IGNORE INTO fuel_ups
         (vin, filled_at, odometer_km, gallons, price_per_gallon, total_cost, is_partial, station, notes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`
    )
      .bind(
        vin,
        filledAt,
        odometerKm,
        gallons,
        pricePerGallon,
        totalCost,
        body.isPartial ? 1 : 0,
        body.station || null,
        body.notes || null,
        Math.floor(Date.now() / 1000)
      )
      .run();

    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return json({ error: "Missing id." }, 400);
    await env.VOLVO_DB.prepare("DELETE FROM fuel_ups WHERE id = ? AND vin = ?").bind(id, vin).run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
