import { json, getVin, vehicleUrl, tryFetch, requireDashboardAuth } from "../../_shared/volvo.js";

// "Software updates" for a Volvo aren't exposed as a public "update available"
// flag anywhere in the Connected Vehicle API — this surfaces the last known
// vehicle/software info the API does report, plus this dashboard's own
// version/changelog (a completely separate, self-referential concern) so the
// Updates tab can show both without pretending Volvo tells us about OTA pushes.
export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    const vin = getVin(env);
    const [details, diagnostics, appVersionRes] = await Promise.all([
      tryFetch(env, vehicleUrl(vin)),
      tryFetch(env, vehicleUrl(vin, "/diagnostics")),
      fetch(new URL("/volvo-version.json", request.url))
    ]);

    const appVersion = appVersionRes.ok ? await appVersionRes.json() : null;

    return json({
      vehicle: details.ok ? details.data : null,
      vehicleError: details.ok ? null : details.error,
      diagnostics: diagnostics.ok ? diagnostics.data : null,
      diagnosticsError: diagnostics.ok ? null : diagnostics.error,
      checkedAt: new Date().toISOString(),
      app: appVersion
    });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
