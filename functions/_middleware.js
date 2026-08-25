const COOKIE_NAME = "hv_auth";

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

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function loginPage(error = "") {
  const errorHtml = error ? `<div class="error">${error}</div>` : "";
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Home Value Tracker · Private</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--panel:#101d31;--border:#25364d;--text:#f8fafc;--muted:#93a4ba;--accent:#67e8f9;--bad:#fca5a5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0%,rgba(103,232,249,.12),transparent 28rem),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(420px,100%);background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:28px}.lock{font-size:40px}h1{margin:14px 0 8px;font-size:28px}.sub{color:var(--muted);line-height:1.5;font-size:14px;margin-bottom:22px}label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}input{width:100%;border:1px solid var(--border);background:#081321;color:var(--text);border-radius:14px;padding:13px 14px;font:inherit;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(103,232,249,.12)}button{width:100%;margin-top:12px;border:0;border-radius:14px;padding:13px 16px;background:var(--accent);color:#04212a;font:inherit;font-weight:800;cursor:pointer}.error{margin:0 0 16px;padding:11px 12px;border-radius:12px;background:rgba(252,165,165,.08);border:1px solid rgba(252,165,165,.3);color:var(--bad);font-size:13px}.back{display:block;text-align:center;margin-top:18px;color:var(--muted);font-size:13px;text-decoration:none}
</style>
</head>
<body><main class="card"><div class="lock">🔐</div><h1>Private dashboard</h1><p class="sub">Enter the same dashboard key used for the Volvo dashboard to view the Home Value Tracker.</p>${errorHtml}<form method="post" action="/api/home-auth"><label for="token">Dashboard key</label><input id="token" name="token" type="password" autocomplete="current-password" required autofocus><input type="hidden" name="next" value="/home-value.html"><button type="submit">Unlock dashboard</button></form><a class="back" href="/index.html">← back to bstef.pages.dev</a></main></body></html>`, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Only protect the home-value page. All existing site routes keep their current behavior.
  if (url.pathname !== "/home-value.html" && url.pathname !== "/home-value") {
    return next();
  }

  if (!env.DASHBOARD_TOKEN) {
    return new Response("Home Value Tracker auth is not configured: DASHBOARD_TOKEN is missing.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const expected = await sha256Hex(env.DASHBOARD_TOKEN);
  const supplied = getCookie(request, COOKIE_NAME);
  if (!timingSafeEqual(supplied, expected)) return loginPage();

  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
