import { json, getVin, requireDashboardAuth } from "../../_shared/volvo.js";

const MI_TO_KM = 1.609344;
const L_TO_GAL = 0.264172;

// Fuelly (and similar trackers like Fuelio/aCar) don't have a public API —
// this is the practical bridge: export your fuel-up history as CSV from
// Fuelly and upload it here once, then keep logging new fill-ups natively.
// Column names vary by exporter/region, so headers are matched loosely by
// keyword rather than an exact expected schema.
const HEADER_ALIASES = {
  date: ["date", "filldate", "filldatetime", "filleddate", "fillupdate"],
  odometer: ["odometer", "odometermi", "odometerkm", "mileage", "miles", "odo"],
  gallons: ["gallons", "gallonus", "volume", "fuelamount", "fuelvolume", "liters", "litres", "fuelvolumel"],
  pricePerGallon: ["price", "priceper", "pricepergallon", "pricepergal", "priceperliter", "priceperlitre", "unitprice", "pricegal", "costpergallon", "ppg"],
  totalCost: ["totalcost", "cost", "totalprice", "amount", "total"],
  partial: ["partial", "partialfill"],
  full: ["fulltank", "full"],
  notes: ["notes", "note", "comments", "comment"],
  station: ["station", "location", "gasstation", "vendor"]
};

function normalizeHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchColumns(headers) {
  const map = {};
  headers.forEach((raw, index) => {
    const norm = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] == null && aliases.includes(norm)) map[field] = index;
    }
    // Fall back to substring matches for headers with extra words/units in
    // either direction — a header can be more specific than the alias
    // ("Odometer (mi)" contains "odometer") or less specific than it
    // ("Price" is contained in the guessed "pricepergallon"). The length
    // guard keeps very short strings from matching everything.
    if (Object.values(map).indexOf(index) === -1 && norm.length >= 3) {
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (map[field] == null && aliases.some((a) => a.length >= 3 && (norm.indexOf(a) !== -1 || a.indexOf(norm) !== -1))) {
          map[field] = index;
          break;
        }
      }
    }
  });
  return map;
}

// Minimal RFC4180-ish CSV parser: quoted fields, doubled-quote escaping,
// commas/newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function parseBool(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

export async function onRequestPost({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const text = await request.text();
    const rows = parseCsv(text);
    if (rows.length < 2) return json({ error: "CSV has no data rows." }, 400);

    const headers = rows[0];
    const cols = matchColumns(headers);
    if (cols.odometer == null || cols.gallons == null) {
      return json({ error: "Couldn't find odometer/gallons columns in the CSV header row: " + headers.join(", ") }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const odometerHeaderNorm = normalizeHeader(headers[cols.odometer]);
    const odoIsKm = odometerHeaderNorm.indexOf("km") !== -1;
    const volumeHeaderNorm = cols.gallons != null ? normalizeHeader(headers[cols.gallons]) : "";
    const volumeIsLiters = volumeHeaderNorm.indexOf("liter") !== -1 || volumeHeaderNorm.indexOf("litre") !== -1 || volumeHeaderNorm.indexOf("l") === volumeHeaderNorm.length - 1;

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      try {
        const dateRaw = cols.date != null ? cells[cols.date] : null;
        const filledAt = dateRaw ? Math.floor(new Date(dateRaw).getTime() / 1000) : NaN;
        const odometerRaw = Number(cells[cols.odometer]);
        const gallonsRaw = Number(cells[cols.gallons]);

        if (!Number.isFinite(filledAt) || !Number.isFinite(odometerRaw) || !Number.isFinite(gallonsRaw) || odometerRaw <= 0 || gallonsRaw <= 0) {
          skipped++;
          continue;
        }

        const odometerKm = odoIsKm ? odometerRaw : odometerRaw * MI_TO_KM;
        const gallons = volumeIsLiters ? gallonsRaw * L_TO_GAL : gallonsRaw;

        let pricePerGallon = cols.pricePerGallon != null ? Number(cells[cols.pricePerGallon]) : null;
        let totalCost = cols.totalCost != null ? Number(cells[cols.totalCost]) : null;
        if (!Number.isFinite(pricePerGallon)) pricePerGallon = null;
        if (!Number.isFinite(totalCost)) totalCost = null;
        if (volumeIsLiters && pricePerGallon != null) pricePerGallon = pricePerGallon / L_TO_GAL;
        if (totalCost == null && pricePerGallon != null) totalCost = Math.round(pricePerGallon * gallons * 100) / 100;
        if (pricePerGallon == null && totalCost != null) pricePerGallon = Math.round((totalCost / gallons) * 1000) / 1000;

        let isPartial = false;
        if (cols.partial != null) isPartial = parseBool(cells[cols.partial]);
        else if (cols.full != null) isPartial = !parseBool(cells[cols.full]);

        // REPLACE (not IGNORE) so re-uploading the same export after a
        // parsing fix corrects previously-imported rows in place, matched
        // on the (vin, filled_at, odometer_km) unique index, instead of
        // silently skipping them as already-imported.
        const result = await env.VOLVO_DB.prepare(
          `INSERT OR REPLACE INTO fuel_ups
             (vin, filled_at, odometer_km, gallons, price_per_gallon, total_cost, is_partial, station, notes, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv-import', ?)`
        )
          .bind(
            vin,
            filledAt,
            odometerKm,
            gallons,
            pricePerGallon,
            totalCost,
            isPartial ? 1 : 0,
            cols.station != null ? cells[cols.station] || null : null,
            cols.notes != null ? cells[cols.notes] || null : null,
            now
          )
          .run();

        if (result.meta?.changes) imported++;
        else skipped++;
      } catch (rowError) {
        errors.push(`Row ${i + 1}: ${rowError.message}`);
      }
    }

    return json({ imported, skipped, errors: errors.slice(0, 10), totalErrors: errors.length });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
