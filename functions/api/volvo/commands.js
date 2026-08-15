import { json, getVin, volvoFetch, vehicleUrl, requireDashboardAuth } from "../../_shared/volvo.js";

// Lists the commands this specific vehicle actually supports, so the
// frontend only renders buttons for actions the car will accept.
export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const payload = await volvoFetch(env, vehicleUrl(vin, "/commands"));
    const commands = (payload?.data || []).map((entry) => entry.command).filter(Boolean);
    return json({ commands });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
