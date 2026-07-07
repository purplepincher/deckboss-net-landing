import landingHtml from "./landing.html";

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);

    // deckboss.ai redirects to the canonical deckboss.net (the real,
    // shipped product's home). deckboss.ai itself is reserved for a
    // possible future DeckBoss-branded ESP32 diagnostics surface, per the
    // org's resolved decision -- not built yet, so it redirects for now.
    if (url.hostname === "deckboss.ai" || url.hostname === "www.deckboss.ai") {
      return Response.redirect(`https://deckboss.net${url.pathname}${url.search}`, 301);
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
