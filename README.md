# deckboss-net-landing — the deckboss.net landing-page Worker

This repo is the **Cloudflare Worker that serves the marketing/landing page
at <https://deckboss.net>**, plus the small backend that powers its
"Field beta" signup form. It is **not** the DeckBoss app itself.

DeckBoss is a voice-first, offline-first fishing logbook. The **app** lives
in a separate repo, [`purplepincher/deckboss`](https://github.com/purplepincher/deckboss),
and is linked to from this landing page. This repo only owns the page at
`deckboss.net` and the form that captures beta sign-ups.

> **Status at a glance**
> - ✅ **The Worker is real and compiles.** Verified with
>   `wrangler deploy --dry-run` under wrangler 4.107.1; the request-handling
>   code in `src/index.ts` was traced end to end.
> - ✅ **Three HTTP endpoints are implemented:** `GET /` (the page),
>   `POST /api/beta-signup`, and `GET /admin/beta-signups`.
> - ✅ **The landing page is committed, real HTML** (`src/landing.html`) with
>   the shared PurplePincher family design system already inlined.
> - ⚠️ **Running it requires external Cloudflare resources:** the
>   `BETA_SIGNUPS` KV namespace and an `ADMIN_TOKEN` secret. See
>   [Configuration](#configuration).
> - 🔮 **No automated test suite.** `package.json`'s `test` script is the
>   default placeholder that exits 1. See [Testing](#testing).

## What the Worker does (routes)

All logic is in `src/index.ts`. The request router:

| request | behavior |
|---|---|
| host `deckboss.ai` / `www.deckboss.ai` | **301 redirect** to `https://deckboss.net` + same path/query. `deckboss.ai` is reserved for a possible future diagnostics surface (not built yet), so it points at the real product for now. |
| `POST /api/beta-signup` | Validates and stores a beta sign-up in the `BETA_SIGNUPS` KV namespace. Returns `201`/`400`/`413`/`415`/`503`. |
| `GET /admin/beta-signups` | Token-protected HTML listing of every stored sign-up, newest first, `noindex`. Returns `401` without a valid token. |
| `GET /` or `/index.html` | Serves the landing page (`src/landing.html`) with a strict Content-Security-Policy and a 5-minute cache. |
| anything else | Falls through to the static-assets binding (`public/`): `/js/beta-signup.js` and the three screenshot PNGs in `/images/`. |

### `POST /api/beta-signup` — validation rules

Read straight from `handleBetaSignup` (`src/index.ts`):

- Requires `Content-Type: application/json` (else `415`).
- Rejects bodies over **8 KiB** (else `413`), checked both via the
  `content-length` header and the parsed text length.
- Parses JSON; malformed/non-object input → `400`.
- Reads five fields — `name`, `contact`, `boat`, `homePort`, `message` —
  each trimmed and capped at **2000 chars**.
- **`name` and `contact` are required** (non-empty); everything else is
  optional (else `400`).
- Stores a record
  `{ id, submittedAt, name, boat, homePort, contact, message }` in KV, keyed
  by `${Date.now()}-${randomUUID first 8 hex}`. Returns `201` on success,
  `500` if the KV write throws.

### `GET /admin/beta-signups` — token auth

- The token is supplied either as `?token=` or an
  `Authorization: Bearer <token>` header.
- The expected value comes from the `ADMIN_TOKEN` secret. A missing or
  unconfigured secret is treated as "no access" — never as "open".
- Comparison is **constant-time and length-leak-safe**: both strings are
  SHA-256 digested first (so they're always equal length) and then
  compared with a per-byte XOR fold that never early-exits (`tokensMatch`
  in `src/index.ts`). This avoids both a timing side-channel and an
  expected-token-length leak.
- On success it renders an escaped, XSS-safe HTML page (every field is
  HTML-escaped; the implementation note records that a literal
  `<script>alert(1)</script>` payload round-trips as inert text) listing
  all submissions newest-first. The page carries `noindex, nofollow`.

See [`CONTACT_FORM_NOTES.md`](./CONTACT_FORM_NOTES.md) for the full design
rationale and the original verification log for the form.

## The landing page

`src/landing.html` is the single served document. It contains, inline:

- The **PurplePincher family design system** (`tokens.css` + `base.css`)
  inlined verbatim into a `<style>` block — this is the "inline at build
  time, never fetch at runtime" pattern documented in
  [`family-styles`](https://github.com/purplepincher/family-styles).
- The deckboss.net site accent swap `--claw: var(--antifoul);`
  (anti-fouling bottom-paint oxide `#B0533A`), plus deckboss-specific
  component CSS.
- Page sections: hero, how-it-works, screenshots, "your data not ours",
  an explicit **"What this is not"** honesty block, the Field Beta signup
  form, and a footer linking to the app repo.
- Google Fonts (Fraunces / IBM Plex) via `<link>`, permitted by the CSP.

The three screenshots (`public/images/screenshot-{record,timeline,entry-detail}.png`)
are real committed images shown in the "What it looks like on deck" section.

The "What this is not" section on the page is load-bearing honesty copy —
DeckBoss is explicitly **not** a regulatory catch-reporting tool, has no
hardware/payment/support SLA, and the beta asks you to keep your current
logging method running in parallel. This README does not soften any of that.

## Configuration

To run or deploy this Worker you need, in your Cloudflare account:

1. **A KV namespace bound as `BETA_SIGNUPS`.** `wrangler.jsonc` references
   namespace id `2029d51fe0584b7bbd8304211e6dbbd8`; that id belongs to the
   real production namespace. For your own deploy, create a namespace
   (`wrangler kv namespace create BETA_SIGNUPS`) and put **its** id in
   `wrangler.jsonc`.
2. **The `ADMIN_TOKEN` secret.** Set it with
   `wrangler secret put ADMIN_TOKEN`. Without it, the admin view returns
   `401` for everyone (by design).

`.dev.vars` (gitignored) is the place to put `ADMIN_TOKEN=<value>` for
local `wrangler dev`.

## Running locally and deploying

```bash
npm install                 # installs wrangler (the only devDependency)

# Local dev — needs BETA_SIGNUPS (a KV id in wrangler.jsonc) + a .dev.vars
# with ADMIN_TOKEN for the admin route to be reachable.
npx wrangler dev

# Deploy to Cloudflare (production)
npx wrangler deploy
```

`wrangler dev` serves the Worker on a local port and is the recommended way
to exercise the routes. Static assets are served from `./public`.

## Content-Security-Policy

The landing-page response sets a strict CSP
(`src/index.ts`):

```
default-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
script-src 'self' https://static.cloudflareinsights.com;
connect-src 'self' https://cloudflareinsights.com;
img-src 'self';
```

Consequences worth knowing:

- The signup handler is an **external** file (`/js/beta-signup.js`), not
  inline, because `script-src` has no `'unsafe-inline'`.
- There is deliberately **no shared-CSS host** in the CSP; the family
  styles are inlined instead (see `src/landing.html`).
- The admin view (`/admin/beta-signups`) is served with `cache-control: no-store`
  and is `noindex`/`nofollow` so submissions are neither cached nor indexed.

## What this repo is NOT

- **Not the DeckBoss app.** The app (voice capture, offline storage,
  Drive/R2/Oracle/.zip sync) is in `purplepincher/deckboss`. This repo is
  only the `deckboss.net` page + its signup form.
- **Not a catch-reporting or regulatory tool.** (Per the landing page's own
  honesty block.)
- **Not the canonical home of the design system.** The shared CSS lives in
  `family-styles`; here it is an inlined, committed copy. Editing the family
  tokens should happen in `family-styles`, then be re-inlined here.
- **Not multi-site.** It is one Worker for one domain.

## Testing

There is **no automated test suite.** The `test` script in `package.json`
is the default `npm init` placeholder that exits 1.

What has been verified:

- The Worker **compiles** under `wrangler deploy --dry-run` (wrangler 4.107.1).
- The endpoint behavior is documented in
  [`CONTACT_FORM_NOTES.md`](./CONTACT_FORM_NOTES.md), which records the
  local `wrangler dev` verification done when the form was built (valid
  POST stores a record; `<script>` payloads round-trip escaped; wrong/missing
  token → `401`; correct token → `200`).

There is no CI in this repo that runs on push.

## License

ISC — see the `license` field in [`package.json`](./package.json). The
landing page links out to the DeckBoss app's MIT license.
