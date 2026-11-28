
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

### Offers Board — applications can leave the database ✅

- **CSV export:** `GET /api/applications/export`, admin only, downloads every
  application (no row limit) with a UTF-8 BOM and CRLF so Excel opens it
  cleanly. Cells are quoted and a leading `=`, `+`, `-` or `@` is prefixed
  with an apostrophe so member text cannot act as a spreadsheet formula.
- **Backup:** `lib/backup.ts` snapshots offers, applications and accounts
  (no password hashes) as JSON into the site's R2 bucket, once a day at most,
  triggered when an admin opens `/admin`; the newest 14 are kept and older
  ones are pruned. `GET /api/backup` returns the same snapshot as a download
  for a copy off the platform, and also refreshes the stored one.
- **Infra:** R2 binding `FILES` provisioned for preview and production and
  attached by deploying.
- **Checks:** typecheck clean; production CSV returns 200 `text/csv` with the
  expected filename, BOM and header row; viewer and signed-out requests get
  401 on both routes; `/admin` shows the snapshot time; the JSON download
  parses with matching counts and contains no `pbkdf2` hash.

### Offers Board — one application per member per offer, enforced ✅

- **Before:** the apply route checked for an existing application and the
  offer page swapped the form for "Application received", but two tabs
  submitting at once could both pass the check and insert two rows.
- **Now:** a partial unique index on `(offer_id, account_id)` is the real
  guard. `createApplication` returns null when the index rejects the row and
  the route answers `409 already_applied`, the same message the pre-check
  gives, so a double submit is indistinguishable from a late second attempt.
- **Existing data:** duplicates are collapsed onto the earliest application
  once, recorded under the `applications_unique_v1` settings key, before the
  index is created.
- **Copy:** the offer page's applied panel now links to My applications and
  states the one-application rule.
- **Checks:** typecheck clean. On production, with throwaway offers and a
  viewer: sequential second apply 409, two simultaneous applies gave one 201
  and one 409, the offer page showed the applied state with no form. Test
  offers were deleted afterwards and the board is back to its prior state
  (0 applications, CSV 0 rows).

### Offers Board — applied state, per-offer counts, one dropdown everywhere ✅

- **Board:** offer cards show a `✓ Applied` chip when the member already has
  an application for that offer. The page loads the member's applied offer ids
  in one query and passes them to the browser component.
- **Admin:** the offers table gains an Applications column (per-offer count,
  `—` when zero) from a single grouped query.
- **UI:** the three remaining native selects (offer role type, account access,
  application status) now use `SelectMenu`, so no OS-drawn popup is left.
  The component grew a `bare` compact trigger and a `disabled` state, and the
  two form selects keep submitting through hidden inputs.
- **Loading:** `PageSkeleton` plus `loading.tsx` for `/offers`, `/admin` and
  `/applications`, so a slow D1 read shows the page shape instead of a blank.
- **Checks:** typecheck clean; on production a throwaway offer and application
  produced the applied chip on the board, `Applications` column with count 1,
  and 3 listbox controls + the hidden role input on `/admin`. Test offer
  deleted afterwards; the board is back to its prior state.

### Offers Board — prove the Discord webhook actually delivers ✅

- **Why:** notifications are deliberately best-effort, so a wrong or expired
  webhook URL fails silently — an application is saved and nobody is pinged.
- **Added:** `POST /api/notify/test`, admin only, posts one message to the
  configured webhook and returns only Discord's status code (the URL is never
  returned or logged). A "Send test ping" control next to the Discord line
  on `/admin` calls it.
- **Checks:** typecheck clean; deployed to production. DISCORD_WEBHOOK_URL is
  still unset on the site, so the control is hidden until the secret exists.

### Offers Board — C monogram favicon and app icon ✅

- **Built from the brand file, not a substitute font:** the first glyph of the
  supplied wordmark is cropped at native resolution (202×226), keyed to alpha
  and composited onto a square tile in the render's own charcoal (`#25333A`)
  with the paper cream (`#F3EFE6`) for the letter.
- **Files:** `src/app/icon.png` (512×512) and `src/app/apple-icon.png`
  (180×180), which Next serves at `/icon.png` and `/apple-icon.png`.
- **Checks:** typecheck clean; production serves both (200, `image/png`, 39,825
  and 6,798 bytes) and the head carries
  `<link rel="icon" ... sizes="512x512">` plus the apple-touch-icon link.

### Offers Board — SelectMenu tightened, phone-width panel verified ✅

- **State and effects:** opening now sets the highlighted row directly (`openMenu()`), which removes the effect that re-synced it from `value`/`options` on every prop change. `close()` lost its never-used `focusTrigger` argument, and the selected row is derived once (`selectedIndex`) instead of being searched for on each render.
- **Rows are listbox options, not buttons:** `role="option"` divs keep DOM focus on the panel, so Tab leaves the menu from the trigger instead of landing on a row that is about to unmount, and the arrow keys keep working after a click.
- **Panel measured against the deployed stylesheet:** 375px — 240px wide, left edge 98px, right 338px, all four corners hit-test to the panel; 320px — left edge 43px, still inside the viewport. The sticky bar declares no `overflow`, and nothing between the panel and `<html>` clips, so the open list paints over the cards below it. The bar’s `z-10` stacking context stays under the header’s `z-20`, but the panel only opens downward and never reaches the header.
- **Found while checking, not fixed:** `/offers` never leaves its `Loading…` skeleton in a browser. The streamed board sits hidden in `<div hidden id="S:0">` and the route-level loading UI is never replaced, while the same HTML arrives complete over curl in 8s — so it is client-side.
- **Checks:** `bun run typecheck` clean. Not deployed.

### Offers Board — hero takes the empty space, keeps the palette ✅

- **The top of the board is now a section, not a title:** warm radial light and a hairline grid fading out behind the headline, an invite / vetted / open-roles pill row, three accent-topped stat tiles (open offers in ember, the rest in paper, each with a footnote), and a live “newest on the board” card that links to the newest open offer with its commission set in ember.
- **New band under it:** three hairline-divided coal cells — See the real split / Apply in a minute / One answer, tracked — so the fold is not just padding between the stats and the filters.
- **Mobile fixes found while checking:** the “Applications” label overflowed a 3-up tile at 390px, so the tiles collapse to label-left / number-right rows; and the featured card truncated “18% of contract value…” next to the CTA, so the commission now sits on its own line with the CTA beneath it.
- **Colour stays inside the brand:** ember on ink/coal/line with paper type, no new hues. The live dot gets a slow `.pulse-dot` halo in `globals.css`, switched off under `prefers-reduced-motion`.
- **Checks:** `bun run build` and typecheck clean. Harness against the built stylesheet — 1280px: three 185px tiles, labels above numbers, footnotes visible; 390px: single column, labels fit, commission renders in full, no horizontal overflow at either width. Not deployed.

### Offers Board — optional closing date, stale offers flagged on /admin ✅

- **Optional closing day:** the offer form gains a `type="date"` field, stored as a new `closes_at TEXT` column (`YYYY-MM-DD`, compared as a UTC calendar day) that `migrate()` adds to existing databases. Left blank it stays `NULL`, which means no deadline, exactly as before.
- **One gate instead of a sweep:** `isTakingApplications(offer)` is `status === "open" && (!closes_at || closes_at >= todayIso())`. The board list, board stats, the apply route and the detail page all call it, so a passed closing day stops collecting applications immediately — no background job, and `status` is not flipped behind the reader's back. `open`/`closed` stays the recorded truth and the existing Close button still works.
- **What a reader sees:** the detail page lists “Applications close <date>” among its facts, then switches to the Closed pill and “Applications closed on <date>.” once the day has gone; a submit against a passed date returns 409 `closed`; the admin table tags each row `closes <date>` or an ember `date passed`.
- **/admin “Needs attention”:** a live list of open offers past their closing day, plus open offers listed more than 14 days with no closing date — each with the reason it needs a decision and an Edit link.
- **Checks:** `bun run typecheck` and `bun run build` clean. Not deployed, so the column reaches production on the next deploy.

### Offers Board — one-off Discord catch-up for unread applications ✅

- **Why:** notifications were switched on after Jordan's application had already landed, so the only record was a row in `/admin` that had never produced a ping. This is the backfill for everything that arrived while the webhook was unset.
- **One button, no new flow:** `/admin` grows a “Push N unread to Discord” link next to the existing test ping, shown only when a webhook is configured and something is unread. It posts each still-`new` application as the same embed a live application produces — same fields, same role mention when one is set, with a line saying it was recovered from before notifications were on. Nothing on the apply path changed.
- **Press it twice safely:** every application Discord has seen is recorded under the `discord_notified_v1` setting, by the live notify and by the backfill alike, so a second click only retries what failed and reports “N already sent” rather than duplicating cards.
- **Server side:** `pushUnreadApplications()` in `notify.ts` walks `listUnreadApplications()` (the new store query for `status = 'new'`) and reports sent / skipped / failed; `POST /api/notify/backfill` is admin-only and answers 400 `not_configured` when there is no webhook, so a misconfigured deployment says so instead of failing silently.
- **Checks:** `bun run typecheck` and `bun run build` clean, with `/api/notify/backfill` in the route list. Not exercised against Discord — there is no webhook value in this deployment yet, so the button cannot be pressed until one is set.

### Offers Board — the board actually appears; dead segment skeletons removed ✅

- **Symptom:** every signed-in page sat on its skeleton forever. The server was fine — `/offers` returned 22 KB of real board HTML in about 4 s, none of it visible.
- **Cause, straight from the markup:** with a `loading.tsx`, Next 16 streamed the page into `<div hidden id="S:0">`, spliced the content in with `$RS("S:1","P:1")`, and closed the document with a single `$RC("B:0","S:0")`. React's inline reveal runtime only swaps content once it is holding **two** completed boundaries (`2===$RB.length`), and the second one never arrived because the segment had already been delivered through the `$RS` path. `$RV` was therefore never scheduled, `S:0` kept its `hidden` attribute, and the skeleton stayed on screen. `/login`, the one route with no `loading.tsx`, had no hidden boundary and always worked — which is what pointed at the loading files.
- **Fix:** deleted the four segment loading files (`/offers`, `/offers/[id]`, `/admin`, `/applications`) and the now-unused `PageSkeleton`. Each route renders inline again: no hidden boundary, no `$RC`, content in the first response.
- **Verified on production in a browser:** `/offers` paints the hero, stat tiles, featured card and the board card; `/applications` lists the signed-in member's application; an offer detail page shows its facts and apply card. `/admin` returns the control room (no “Needs attention” yet — the only open offer is a day old, which is correct), and no route emits a hidden boundary any more.
- **Trade-off:** pages now wait ~4 s on D1 before the first byte instead of painting a skeleton first. That skeleton was unobtainable while the reveal was broken, and a delayed board beats one that never appears.

### Offers Board — the status menu escapes the applications table ✅

- **Symptom:** the compact status listbox in the admin applications table was clipped by the table's `overflow-x-auto` wrapper, so opening it on a lower row showed a sliver of the panel and no way to reach the choices.
- **Fix:** `SelectMenu` gained an opt-in `portal` prop. With it, the panel is rendered through `createPortal` onto `<body>` at `position: fixed`, anchored to the trigger's rect (right-aligned, clamped to the viewport, and flipped above the trigger when there is no room below). `ApplicationStatus` passes it; nothing else does, so the sort menu in the sticky filter bar keeps its in-place `absolute` panel.
- **Behaviour kept:** the same pointerdown-outside, Escape, Tab and arrow handling. Outside-click also treats the portal panel as inside, so choosing a row still works; a scroll of the page or the table closes the panel rather than leaving it floating, and a resize re-anchors it.
- **Verified on production in the browser:** the panel is a child of `<body>`, `position: fixed`, and its box (336–490 px) runs past the table container (bottom 358) yet sits fully inside the viewport; hit-testing the middle of the panel lands on the “Shortlisted” option. Choosing “New” closed it and left the status unchanged. On `/offers`, the sort menu still renders `absolute` inside its own trigger wrapper, right-aligned and 240 px wide, exactly as before. Typecheck and build clean.

### Offers Board — the status menu opens in place, inside the table ✅

- **Symptom (again):** the status listbox in the admin applications table is inside an `overflow-x-auto` wrapper, which clips on both axes, so a panel hanging below the last rows was cut off.
- **Fix:** the option is now `pinned` rather than portalled. The panel stays in the table's own markup — inside the `<td>`, inside the scroller — but is laid out with `position: fixed` against the viewport, which an ancestor's `overflow` cannot clip, and it is anchored to the trigger's rect exactly as before (right-aligned, clamped to the viewport, flipped above when the room below runs out).
- **Look unchanged:** same background, border, radius, shadow, 176 px width and 8 px gap under the trigger; only the containing block moved. The sort menu in the filter bar still opts out and renders its 240 px `absolute` panel inside its own wrapper.
- **Verified on production in the browser:** the open panel reports `insideTable: true`, `insideScroller: true`, `parentElement !== document.body`, `position: fixed`, 176 px wide. Its box runs 336–490 px while the scroller ends at 358 — it crosses the clip line and is still fully inside the viewport, and hit-testing the middle of it lands on the “Shortlisted” option. `/offers` sort menu: `absolute`, inside its wrapper, 240 px, right-aligned. Typecheck and build clean.

### Offers Board — the accent palette is now the logo's ivory on slate ✅

- **Sampled the supplied logo:** `#25333a` behind the wordmark, `#e5dece` in the letters — 96% of the image is that one slate. The icons already sat on `#25333a`, so the board was the odd one out with its `#ff5a1f` orange.
- **Tokens (`globals.css`):** ink `#25333a` (the logo's own background), coal `#2d3a41`, line `#3f4d54`, paper `#ded7c6`, mute `#a2adaf`, and the accent `--color-ember` is now the logo ivory lifted to `#f2ecdd` so links, labels, pills and the primary button still lead the body text.
- **No orange left anywhere:** the hero's glow, hairline grid, stat-tile tops and featured-card wash (three inline `rgba(255,90,31,…)` gradients), the checkbox accent in the offer form, the listbox surface in `SelectMenu`, the button/pill hover borders, the inset field background and the Discord embed stripe (`0xf2ecdd`) all moved to the logo palette.
- **Contrast, measured:** paper on ink 9.08:1, accent on ink 11.04:1, ink on accent 11.04:1, mute on ink 5.66:1, mute on card 5.09:1 — AA everywhere, AAA for body and accent.
- **Checked:** `bun run typecheck` and `bun run build` clean, and a harness rendered against the compiled stylesheet shows the hero, pills, both buttons, cards, monogram, field and listbox in the new palette.

### Offers Board — a hairline progress bar while a route loads ✅

- **Why:** the segment `loading.tsx` files are gone (this runtime never reveals their boundary), so clicking a board link left the old page sitting inert for the 2–5 s D1 takes to answer, with no way to tell the click had registered.
- **`NavProgress`** (client, mounted in the root layout, above the header): one capture-phase click listener on the document tracks same-origin, same-tab links that would change the pathname — hash links, downloads, `target="_blank"`, modifier-clicks and external URLs are ignored. The bar appears only after 150 ms so a prefetched route never flashes it, is cleared the moment `usePathname()` changes, and has a 12 s safety stop in case a navigation never lands. Under `prefers-reduced-motion` it is a static full-width bar instead of the sweeping one.
- **Nothing else needed a spinner:** every mutating action already reports its own state — “Sending…”, “Saving…”, “Creating…”, “Pushing…”, the test ping, the row busy flags and the disabled status menu.
- **Verified on production in the browser:** a hydration marker survived the click, so the route change is client-side as intended; `.nav-progress` was present 150 ms after clicking Board from `/applications` (the route took seconds), and it was gone with the “Offers worth closing.” heading once the navigation landed.

### Offers Board — /offers streams its hero, the board fills in behind Suspense ✅

- **Shell first:** the page now awaits only `boardStats()` — the hero, its pills and the three stat tiles render from that. The offer list is started as a promise and never awaited by the shell, so the first flush carries the headline at byte 3.3 KB instead of the whole page.
- **Two in-page boundaries:** the “Newest on the board” card and the filter row plus board cards are separate `<Suspense>` sections that await the shared list. Each has a fallback shaped like what replaces it (`FeaturedSkeleton`, `BoardSkeleton`, using the existing `.skeleton` sweep), so the hero does not jump when they land.
- **Why not `loading.tsx`:** that is a route-segment boundary, and this runtime streams it as a segment splice; an explicit in-page boundary is a plain React suspense, which emits the ordinary `<template id="B:n">` / `<div hidden id="S:n">` / `$RC("B:n","S:n")` pair. The deployed HTML now has two boundaries, two `$RC` calls and no `$RS` splice.
- **Measured:** steady-state TTFB 0.55–0.87 s (3.4 s only on the first request after a deploy), full page ~1.0 s.
- **Verified in a visible browser:** `$RT` set, `$RB` emptied, both hidden boundary divs gone, 0 skeletons left, the featured card reading “High-ticket closer — B2B SaaS”, the board article and its search box present.
- **Test-environment note worth keeping:** a tab that is not composited (`document.visibilityState === "hidden"`, which is what the automation browser reports until it is forced to paint) never fires `requestAnimationFrame`, and React schedules its reveal through `requestAnimationFrame`. In that state the content stays in its hidden boundary and only the skeleton is visible — the exact symptom reported earlier. Recording the tab made it visible, the frame ran, and React revealed everything on its own.
