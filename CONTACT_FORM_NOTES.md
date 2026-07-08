# Contact form implementation notes

Replaces the GitHub Discussions link in deckboss.net's Field Beta section
(found via real-render testing earlier this session to be "a place most
working captains do not go") with a real, working signup form.

## What was built

- **Form** in `src/landing.html`'s Field Beta section: name, boat name,
  home port, contact (email or phone, free text), optional message. Real
  byline near the form and in the confirmation: "Captain Casey DiGennaro,
  F/V Eileen, out of Sitka, Alaska."
- **`POST /api/beta-signup`** (`src/index.ts`): validates a non-empty
  name and contact, enforces an 8KB body cap and per-field length caps,
  requires `application/json`, stores the submission in the real
  `BETA_SIGNUPS` KV namespace keyed by a timestamp+random ID, returns
  201/400/413/415/503 as appropriate. No silent failures.
- **`GET /admin/beta-signups`**: requires the real `ADMIN_TOKEN` secret
  via `?token=` or `Authorization: Bearer` — compared via a SHA-256
  digest + constant-time XOR fold (not `===`), so neither a timing
  side-channel nor an expected-length leak is possible. Wrong/missing
  token gets a bare 401 with no information disclosed. Right token lists
  all real stored submissions as escaped HTML (XSS-safe — verified with
  a literal `<script>alert(1)</script>` submission, which round-tripped
  as inert text), newest first, with `noindex, nofollow` so it's not
  indexed.
- **`public/js/beta-signup.js`**: a real external script (not inline —
  required for the existing CSP's `script-src 'self'` with no
  `unsafe-inline`) handling the form submit via `fetch`, swapping to a
  confirmation message on success, showing a real error message on
  failure.
- **`wrangler.jsonc`**: real `BETA_SIGNUPS` KV binding
  (`2029d51fe0584b7bbd8304211e6dbbd8`).

## What was actually verified (via local `wrangler dev`, before this commit)

- Landing page serves 200, contains the form, byline, and confirmation
  block, each exactly once.
- The old GitHub Discussions link is fully removed from the page (zero
  occurrences).
- A real POST with valid fields stores a real record; a real POST with a
  `<script>` payload round-trips HTML-escaped in the admin view, not
  executed.
- `/admin/beta-signups` returns 401 with a wrong or missing token, and
  200 with the real stored submissions with the correct token.
- No token value appears in dev server logs, error response bodies, or
  anywhere in `src/`/`public/`.
- CSP header unchanged and satisfied by the external script file.

## Not yet verified (real next step)

This was tested locally against `wrangler dev`, not yet deployed to the
live `deckboss.net` Worker. The real `ADMIN_TOKEN` secret already exists
on the live Worker (set earlier this session) — deployment should reuse
it, not silently create a new one.
