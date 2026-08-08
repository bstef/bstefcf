import { json, listZones } from "../_shared/cf.js";

export async function onRequestGet({ env }) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    return json({ error: "Missing CLOUDFLARE_API_TOKEN secret on the Pages project." }, 500);
  }

  try {
    const zones = await listZones(env);
    zones.sort((a, b) => a.name.localeCompare(b.name));
    return json({ zones });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
