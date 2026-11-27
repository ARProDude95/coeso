
### Offers Board — Batch 1 design pass ✅

- **Card hierarchy:** commission is now the hero figure on each board card
  (display face, ember, its own bordered band), with the company monogram as the
  logo stand-in and a "New this week" badge for offers under seven days old.
  Extracted into `components/offer-card.tsx` so the card is one definition.
- **Login gate:** a blurred, non-interactive teaser of the board sits under the
  sign-in panel with a gradient scrim and a "the board is behind the door"
  overlay. The teaser is illustrative markup only — no board data is read for a
  signed-out visitor.
- **Consistent rhythm:** one `.eyebrow` label style, one card padding scale
  (`p-5 sm:p-6`), one section spacing scale across board, detail and applications.
- **Keyboard focus:** a single `:focus-visible` ring (ember, 2px, 2px offset) in
  `globals.css` covers every link, button and field; mouse users see no ring.
- **Skeletons:** `app/offers/loading.tsx` and `app/offers/[id]/loading.tsx` mirror
  the real layouts (hero, sticky filter bar, card grid, apply aside) so the swap
  to content does not jump. Shimmer is disabled under reduced-motion.
- **Empty states:** one `EmptyState` component. The board distinguishes "board is
  quiet" (no offers at all) from "no matches", and the applications page now uses
  the same shape with a CTA.
- **Mobile filters:** the search + role pills sit in a sticky bar under the header
  below `sm`, with a horizontally scrollable, scrollbar-free pill row; on wider
  screens it returns to normal flow. Active role carries `aria-current="page"`.
- **Checks:** `tsc --noEmit` clean; OpenNext build clean; new CSS classes present
  in the built stylesheet (`.monogram`, `.skeleton`, `:focus-visible`,
  `top-[61px]`, `.card-link`, `.eyebrow`). Preview (6 cards): 6 monograms, 6
  commission heroes, 3 new-this-week badges, 1 featured, filter empty state
  renders. Production: login teaser + CSS 200; board renders its empty state
  because production has no offers yet. No browser/screenshot review was done.

### Offers Board — Batch 2 interactivity pass ✅

- **Instant board:** the server sends the open offers once and
  `components/board-browser.tsx` filters, sorts and chips them in the browser —
  no round trip per keystroke. Search covers title, company, description,
  requirements and pay type; charts are multi-select chips for role and for every
  pay structure actually present on the board.
- **Sorting:** newest, biggest commission (first number in the commission string,
  so "18%" and "$900" order sensibly), oldest, company A–Z. Logic lives in
  `lib/board-filter.ts` as a pure function.
- **Shortlist:** ★ on each card writes to `localStorage` under
  `coeso.shortlist.offers`; the "★ Shortlisted · n" chip filters to it and
  unstarring from inside the filter removes the row immediately.
- **Compare:** up to three offers; a fixed tray at the bottom holds the
  selection and "Compare" opens a side-by-side table (role, commission, pay,
  posted, open/remove). The selection is stored under `coeso.compare.offers` so
  opening an offer and coming back does not clear it.
- **Apply form:** inline validation per field (email shape, Discord, a little
  experience detail, whole hours 1–80, message cap) with `aria-invalid`,
  `aria-describedby` and a focus jump to the first invalid field on submit. A
  draft is written to `coeso.apply.draft.<offerId>` on every keystroke, restored
  on return with a "Picked up where you left off" note and "Start over", and
  cleared on successful submit. Validation and draft normalization live in
  `lib/apply-fields.ts`.
- **Checks:** `tsc --noEmit` clean; OpenNext build clean; 26 pure-logic checks
  passed under Bun (search/role/pay/shortlist filters, four sort orders, pay
  option derivation, validation rules, draft normalization). Local workerd:
  board renders 6 cards each with shortlist + compare controls, sort select and
  chips; apply API still answers 400 for a bad email, 201 for a valid
  application, 409 for a repeat. Both environments deployed: preview shows the
  controls on 6 cards, production renders the filter bar and empty state (no
  offers yet).
- **Not verified:** the browser-only behaviour itself (keystroke filtering,
  localStorage persistence across a closed tab, the compare tray and the draft
  restore) — no browser automation was run, per the standing HTTP-only rule.

### Offers Board — admin responsiveness ✅

- **Toasts:** `components/toast.tsx` provides a `ToastProvider` mounted in the
  root layout and a `useToast()` hook. Success and error toasts stack bottom
  centre on phones and bottom right on desktop, auto-dismiss after 4.5s, and sit
  in an `aria-live="polite"` region with a dismiss button.
- **Optimistic offers:** the admin table is now `components/offers-table.tsx`.
  Close and Reopen flip the row's status immediately and roll back only if the
  PATCH fails; Delete removes the row first and restores it on failure. No
  `router.refresh()` anywhere in the table. `status-toggle.tsx` and
  `delete-button.tsx` are gone.
- **Optimistic applications:** the status select updates the moment it changes
  and reverts on failure, with a toast on success ("Moved to Shortlisted") and
  on error. Marking someone hired dispatches a `coeso:offer-closed` window event
  that the offers table listens for, so the offer shows as closed on the same
  page without a reload.
- **Copy for Discord:** `components/copy-application.tsx` formats an application
  as Discord markdown — member, `@handle` in backticks, email, offer and company,
  hours, status, received date, an Experience block and Notes when present — and
  copies it with `navigator.clipboard`, falling back to a hidden textarea. The
  toast confirms what was copied or says the clipboard was blocked.
- **Checks:** `tsc --noEmit` clean; OpenNext build clean; 14 formatter assertions
  passed under Bun (structure, handle formatting, offer/company line, status
  label, date, experience block, Notes only when present, name fallback, missing
  offer tolerated, no trailing newline). Local workerd: `/admin` renders 6 Close
  buttons, a Delete per offer, a Copy per application and the toast live region;
  PATCH status, close, reopen and DELETE all answer 200. Deployed to both
  environments; preview shows the Close buttons on 6 offers and Copy on its 2
  applications, production renders the toast region with its empty tables.
- **Not verified:** the real click-through (toast appearance, rollback on a
  forced network failure, clipboard contents in a browser) — HTTP and logic
  checks only, no browser automation.

### Offers Board — owner lockout recovery ✅

- **The gap:** the board has no sign-up and `seedAdmin()` only creates an admin
  when the table has none, so losing the admin password was permanent. There was
  no way back in short of editing D1 by hand.
- **`lib/admin-reset.ts`:** one narrow recovery path. `POST
  /api/auth/reset-admin` takes `{ token, password }`; the token must match
  `ADMIN_RESET_TOKEN` from the environment (minimum 32 characters, compared
  with SHA-256 + `timingSafeEqual`). With the variable unset the route answers
  `404 not_found`, so a normal deployment has no reset surface at all.
- **Single use:** on success the token's SHA-256 is written to a new `settings`
  table under `admin_reset_used`, and that exact token is refused with 409 from
  then on. A later reset needs a new token value. Nothing is stored in
  plaintext, logged or returned.
- **Which account:** `getRecoveryAdmin()` prefers the admin named by
  `ADMIN_USERNAME`, falling back to the oldest admin — and it includes
  *disabled* admins, since disabling the account is another way to lock out.
  A successful reset re-enables the account and sets the new password.
- **Responses:** `400 weak_password` (under 12 characters), `401
  invalid_token` (after a 400ms delay), `404 not_found` (feature off), `409
  already_used` / `no_admin`, `200 {ok, username}`. Every response is
  `cache-control: no-store`.
- **Checks:** `npm run typecheck` clean; OpenNext build clean. Local workerd
  against a real D1 binding (`wrangler dev`, `.dev.vars`, no browser): wrong
  token 401, short password 400, correct token 200, replay 409, new password
  logs in 200, old password 401. With a second admin disabling the first: reset
  returns `200 {username:"admin"}`, that account signs in again, `/admin` 200,
  and its `active` flag is back to 1. Rows and accounts created for the test
  were deleted; `.dev.vars` and both temp logs removed.
- **Not verified:** a real lockout on production (the recovery path was never
  exercised against the live admin, only locally with a throwaway admin), and
  no browser review.

### Offers Board — login form no longer fights the browser ✅

- **Symptom:** the owner reported "wrong credentials" while the server accepted
  the same strings (all three accounts returned 200 to the login API).
- **Cause class:** a stale saved password autofilled into the form. The password
  field asked for `current-password`, which invites the browser's password
  manager to inject an old value; the API then correctly rejects it.
- **Fix:** `components/login-form.tsx` now sets `autoComplete="off"` on the
  username and `autoComplete="new-password"` on the password, plus
  `autoCorrect="off"` / `spellCheck={false}`, so a browser does not fill either
  field. Board credentials are handed out by the owner, so autofill can only
  ever be wrong here.
- **Checks:** Next build clean; deployed production. `/login` HTML carries
  `autoComplete="off"` on `#login-username` and `autoComplete="new-password"` on
  `#login-password`. Admin password was rotated through the recovery endpoint
  (`200 {"ok":true,"username":"admin"}`, replay `409`), the new password signs
  in (`200`, `/admin` 200), and `.env.local` was updated to match. Not reviewed
  in a browser.

### Offers Board — members can be given passwords you can dictate ✅

- **Change:** `PATCH /api/accounts/:id` accepts an optional `password` on
  `reset_password` (8–200 chars; letters, numbers, dots, dashes or
  underscores, no spaces). Without it the route still generates a random
  password, so the admin page's Reset button is unchanged.
- **Live:** `jordan` and `sam` were both moved off random 14-character
  passwords to short dictated ones. `sam` had been deleted from production,
  so it was recreated as an active viewer and given the same style of
  password.
- **Checks:** typecheck clean; both accounts sign in (`200`, `role=viewer`),
  `/offers` 200, `/admin` 307, and each account's previous password now
  returns 401. A 5-character password is rejected with 400 before anything
  is hashed. Passwords are deliberately not recorded in this file.

### Offers Board — supplied Coeso logo in the header ✅

- **Asset:** `public/coeso-logo.png` — the supplied square render, trimmed to
  the wordmark, background keyed to transparency and recoloured to the board's
  paper tone, exported at 525×120 for a 20px-tall header slot.
- **Use:** `app/layout.tsx` renders it as a plain `<img>` (no image optimiser
  needed on Workers) with explicit width/height, replacing the typed COESO.
- **Checks:** typecheck clean; production `/login` serves the img tag and
  `/coeso-logo.png` returns 200 `image/png`. Not reviewed in a browser.

### Offers Board — sort control in the board's own palette ✅

- **Symptom:** the sort control was a native `<select>`, so the open menu was
  drawn by the OS: white panel, blue highlight, ignoring the dark board.
- **Fix:** `components/select-menu.tsx`, a listbox button + panel styled with
  the board's line/coal/paper/ember tokens, an ember chevron that flips when
  open, a hover/active row and an ember tick on the current choice.
- **Behaviour:** listbox roles, arrows, Home/End, Enter/Space to choose,
  Escape closes and returns focus, click outside closes, opens on the current
  value, scrolls the active row into view.
- **Checks:** typecheck clean; production `/offers` serves
  `aria-label="Sort offers: Newest first"` and no `<select id="board-sort">`.
  Keyboard and pointer behaviour not exercised in a browser.

### Offers Board — no more "ADMIN ADMIN" in the nav ✅

- **Symptom:** the nav showed the admin link and the signed-in username side
  by side, and the nav uppercases its items — so an admin account called
  `admin` read as two identical ADMINs.
- **Fix:** the admin link is now labelled "Control room", matching the page
  heading it opens, so the nav reads Control room · admin.
- **Checks:** typecheck clean; production `/offers` and `/admin` nav text is
  `Coeso Board My applications Control room admin Sign out` for an admin.
