import { json, getVin, volvoFetch, vehicleUrl } from "../../_shared/volvo.js";

// Allowlist of commands this dashboard is willing to send, independent of
// whatever the vehicle-reported /commands list contains, so a malformed or
// unexpected body can never reach the Volvo API as an arbitrary path segment.
const ALLOWED_COMMANDS = new Set([
  "lock",
  "unlock",
  "lock-reduced-guard",
  "climatization-start",
  "climatization-stop",
  "flash",
  "honk",
  "honk-and-flash",
  "engine-start",
  "engine-stop"
]);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON with a \"command\" field." }, 400);
  }

  const command = body?.command;
  if (!ALLOWED_COMMANDS.has(command)) {
    return json({ error: `Unsupported command "${command}".` }, 400);
  }

  try {
    const vin = getVin(env);
    const payload = await volvoFetch(env, vehicleUrl(vin, `/commands/${command}`), { method: "POST", body: "{}" });
    return json({ command, result: payload?.data ?? payload });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
