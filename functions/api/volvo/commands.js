import { json, getVin, volvoFetch, vehicleUrl } from "../../_shared/volvo.js";

// Lists the commands this specific vehicle actually supports, so the
// frontend only renders buttons for actions the car will accept.
export async function onRequestGet({ env }) {
  try {
    const vin = getVin(env);
    const payload = await volvoFetch(env, vehicleUrl(vin, "/commands"));
    const commands = (payload?.data || []).map((entry) => entry.command).filter(Boolean);
    return json({ commands });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
