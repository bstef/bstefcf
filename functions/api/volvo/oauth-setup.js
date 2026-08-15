import { json, requireDashboardAuth, requireEnv, requestToken, saveToken, AUTHORIZE_URL } from "../../_shared/volvo.js";

// One-time setup helper: turns the manual "build a PKCE authorization URL,
// log in, copy the code, exchange it by hand" OAuth dance into two clicks
// from volvo-setup.html. Gated behind the same DASHBOARD_TOKEN as everything
// else so a stranger can't use it to run an authorization flow against your
// app registration.

export async function onRequestGet({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    requireEnv(env, ["VOLVO_CLIENT_ID"]);
    return json({ clientId: env.VOLVO_CLIENT_ID, authorizeUrl: AUTHORIZE_URL });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireDashboardAuth(request, env);
    requireEnv(env, ["VOLVO_CLIENT_ID", "VOLVO_CLIENT_SECRET"]);

    const body = await request.json().catch(() => ({}));
    const { code, codeVerifier, redirectUri } = body;
    if (!code || !codeVerifier || !redirectUri) {
      return json({ error: "Missing code, codeVerifier, or redirectUri." }, 400);
    }

    const payload = await requestToken(env, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    let savedToD1 = false;
    if (env.VOLVO_DB) {
      try {
        await saveToken(env, payload);
        savedToD1 = true;
      } catch {
        savedToD1 = false;
      }
    }

    return json({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      savedToD1
    });
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}
