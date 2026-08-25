const COOKIE_NAME = "hv_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function redirect(location, cookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DASHBOARD_TOKEN) {
    return new Response("DASHBOARD_TOKEN is not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("logout") === "1") {
    return redirect("/index.html", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, GET" } });
  }

  const form = await request.formData();
  const token = String(form.get("token") || "");
  const next = String(form.get("next") || "/home-value.html");

  if (!timingSafeEqual(token, env.DASHBOARD_TOKEN)) {
    return redirect("/home-value.html?auth=failed");
  }

  const sessionValue = await sha256Hex(env.DASHBOARD_TOKEN);
  const cookie = `${COOKIE_NAME}=${sessionValue}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/home-value.html";
  return redirect(safeNext, cookie);
}
