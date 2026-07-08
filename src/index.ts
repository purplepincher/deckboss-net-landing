import landingHtml from "./landing.html";

interface Env {
  ASSETS: Fetcher;
  BETA_SIGNUPS: KVNamespace;
  ADMIN_TOKEN: string;
}

// Hard caps so the endpoint can't be trivially abused. A real signup is a
// few hundred bytes at most; this leaves comfortable headroom while still
// bounding work per request.
const MAX_SIGNUP_BYTES = 8 * 1024;
const MAX_FIELD_LEN = 2000;

// ---- small helpers ----------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Constant-time equality of two strings. Both are SHA-256 digested first so
// we always compare equal-length buffers regardless of the input lengths --
// a naive length check would itself leak the expected token's length. The
// per-byte XOR fold means no early exit on a mismatched byte.
async function tokensMatch(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(given)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(expected)));
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function readBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1].trim() : null;
}

// ---- POST /api/beta-signup -------------------------------------------

async function handleBetaSignup(request: Request, env: Env): Promise<Response> {
  if (typeof env.BETA_SIGNUPS?.put !== "function") {
    return json(503, { ok: false, error: "Signups are not available right now." });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_SIGNUP_BYTES) {
    return json(413, { ok: false, error: "Submission too large." });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(415, { ok: false, error: "Expected application/json." });
  }

  const raw = await request.text();
  if (raw.length > MAX_SIGNUP_BYTES) {
    return json(413, { ok: false, error: "Submission too large." });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Malformed JSON." });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json(400, { ok: false, error: "Invalid submission." });
  }

  const fields = parsed as Record<string, unknown>;
  const clean = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, MAX_FIELD_LEN) : "";

  const name = clean(fields.name);
  const contact = clean(fields.contact);
  const boat = clean(fields.boat);
  const homePort = clean(fields.homePort);
  const message = clean(fields.message);

  if (!name || !contact) {
    return json(400, { ok: false, error: "Name and contact are required." });
  }

  const submittedAt = new Date().toISOString();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const record = { id, submittedAt, name, boat, homePort, contact, message };

  try {
    await env.BETA_SIGNUPS.put(id, JSON.stringify(record));
  } catch {
    return json(500, { ok: false, error: "Could not store submission. Please try again." });
  }

  return json(201, { ok: true });
}

// ---- GET /admin/beta-signups -----------------------------------------

async function listAllSignups(env: Env): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.BETA_SIGNUPS.list({ cursor });
    for (const key of list.keys) {
      const raw = await env.BETA_SIGNUPS.get(key.name);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") out.push(obj as Record<string, unknown>);
      } catch {
        // Skip a corrupt entry rather than failing the whole listing.
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  out.sort((a, b) => {
    const ta = String(a.submittedAt ?? "");
    const tb = String(b.submittedAt ?? "");
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  return out;
}

function renderAdminHtml(entries: Record<string, unknown>[]): string {
  const count = entries.length;
  const articles = entries
    .map((e) => {
      const name = escapeHtml(String(e.name ?? "(no name)"));
      const boat = e.boat ? escapeHtml(String(e.boat)) : "—";
      const homePort = e.homePort ? escapeHtml(String(e.homePort)) : "—";
      const contact = escapeHtml(String(e.contact ?? ""));
      const message = e.message ? escapeHtml(String(e.message)) : "";
      const submittedAt = escapeHtml(String(e.submittedAt ?? ""));
      return `<article class="signup">
  <header><h2>${name}</h2><time>${submittedAt}</time></header>
  <dl>
    <dt>Boat</dt><dd>${boat}</dd>
    <dt>Home port</dt><dd>${homePort}</dd>
    <dt>Contact</dt><dd>${contact}</dd>
    ${message ? `<dt>Message</dt><dd>${message}</dd>` : ""}
  </dl>
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>DeckBoss field beta signups</title>
<style>
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background:#fff; color:#111; max-width:760px; margin:0 auto; padding:28px 20px 64px; }
  h1 { font-size:1.35rem; margin:0 0 4px; }
  .sub { color:#555; font-size:.92rem; margin:0 0 24px; }
  .signup { border:1px solid #d8d8d8; border-radius:10px; padding:16px 18px; margin:16px 0; }
  .signup header { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
  .signup h2 { font-size:1.05rem; margin:0; }
  .signup time { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem; color:#555; }
  dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:6px 14px; }
  dt { color:#666; font-weight:600; }
  dd { margin:0; word-break:break-word; }
  .empty { color:#555; }
</style>
</head>
<body>
<h1>DeckBoss field beta signups</h1>
<p class="sub">${count} submission${count === 1 ? "" : "s"}, newest first.</p>
${count ? articles : '<p class="empty">No submissions yet.</p>'}
</body>
</html>`;
}

async function handleBetaSignupsList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const given =
    url.searchParams.get("token") ?? readBearerToken(request.headers.get("authorization"));

  // Treat a missing/unconfigured token the same as a mismatch: no match.
  const expected = typeof env.ADMIN_TOKEN === "string" && env.ADMIN_TOKEN ? env.ADMIN_TOKEN : "";
  const ok = given && expected ? await tokensMatch(given, expected) : false;
  if (!ok) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Bearer realm="beta-signups"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const entries = await listAllSignups(env);
  return new Response(renderAdminHtml(entries), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---- entry -----------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // deckboss.ai redirects to the canonical deckboss.net (the real,
    // shipped product's home). deckboss.ai itself is reserved for a
    // possible future DeckBoss-branded ESP32 diagnostics surface, per the
    // org's resolved decision -- not built yet, so it redirects for now.
    if (url.hostname === "deckboss.ai" || url.hostname === "www.deckboss.ai") {
      return Response.redirect(`https://deckboss.net${url.pathname}${url.search}`, 301);
    }

    if (url.pathname === "/api/beta-signup" && request.method === "POST") {
      return handleBetaSignup(request, env);
    }
    if (url.pathname === "/admin/beta-signups" && request.method === "GET") {
      return handleBetaSignupsList(request, env);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(landingHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "content-security-policy":
            "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self'",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
