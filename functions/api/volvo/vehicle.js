import { json, getVin, vehicleUrl, energyUrl, tryFetch } from "../../_shared/volvo.js";

// Aggregates every Connected Vehicle / Energy resource into one response.
// Not every resource applies to every vehicle (e.g. `fuel` on a pure EV, or
// `energy` on an ICE car), so each one is fetched independently and marked
// unavailable rather than failing the whole request.
const RESOURCES = [
  ["details", (vin) => vehicleUrl(vin)],
  ["doors", (vin) => vehicleUrl(vin, "/doors")],
  ["windows", (vin) => vehicleUrl(vin, "/windows")],
  ["odometer", (vin) => vehicleUrl(vin, "/odometer")],
  ["tyres", (vin) => vehicleUrl(vin, "/tyres")],
  ["warnings", (vin) => vehicleUrl(vin, "/warnings")],
  ["diagnostics", (vin) => vehicleUrl(vin, "/diagnostics")],
  ["statistics", (vin) => vehicleUrl(vin, "/statistics")],
  ["engineStatus", (vin) => vehicleUrl(vin, "/engine-status")],
  ["fuel", (vin) => vehicleUrl(vin, "/fuel")],
  ["brakes", (vin) => vehicleUrl(vin, "/brakes")],
  ["energy", (vin) => energyUrl(vin, "/state")]
];

export async function onRequestGet({ env }) {
  try {
    const vin = getVin(env);
    const entries = await Promise.all(
      RESOURCES.map(async ([key, urlFn]) => [key, await tryFetch(env, urlFn(vin))])
    );

    const result = { vin, fetchedAt: new Date().toISOString() };
    const unavailable = [];
    for (const [key, outcome] of entries) {
      if (outcome.ok) {
        result[key] = outcome.data;
      } else {
        unavailable.push({ resource: key, reason: outcome.error, status: outcome.status });
      }
    }
    if (unavailable.length) result.unavailable = unavailable;

    return json(result);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
