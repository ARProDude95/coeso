# PROGRESS — Coeso Offers Board

Work log for the seven-feature request. One section per feature, updated as it
lands. Assumptions are made rather than asked, and listed below.

## Reality check (what this repo actually is)

The brief describes "Next.js + TypeScript + Tailwind + Postgres … Discord login
and free/Pro/Elite tiers". This repository is Next.js 16 + TypeScript + Tailwind
v4 on **Cloudflare D1 (SQLite)** with **email+password login** (jose session
cookie) and a **board-level `free`/`paid` plan flag** in `settings`. No Postgres
and no Discord login. Per-member Pro/Elite tiers were only an admin-assigned
flag until feature 8 added real Whop subscriptions.

## Assumptions

1. **Database is D1/SQLite, not Postgres.** A "migration" here means guarded
   DDL appended to the `SCHEMA` array / `ensureColumn` calls in
   `src/lib/d1.ts` plus the reference copy in `db/schema.sql`. It runs
   idempotently on first request; there is no migration command.
2. **Login stays email+password.** "Discord DM from the bot" and "the bot
   assigns a role" are implemented as best-effort Discord REST calls that run
   only when `DISCORD_BOT_TOKEN` (+ `DISCORD_GUILD_ID`, and
   `TOP_CLOSER_ROLE_ID` for the leaderboard) are configured. Without them the
   in-app path still works and the Discord step is skipped with a logged note —
   nothing blocks a feature on credentials this app does not have.
3. **free/Pro/Elite started as a per-user tier** on `users.tier`, assigned by
   the admin. Since the Whop work (feature 8) the authoritative value is the
   `subscriptions` row: `getAuthContext` computes the tier with
   `effectiveTier(subscription)`, and `users.tier` is only the fallback for
   accounts that never subscribed. The board-level `settings.plan`
   (`free`/`paid`) still gates the Discord channel features separately.
4. **PARTNER is the `partner` role slug** in the existing `user_roles` table,
   admin-assigned (the brief allows "or admin-assigned"). No Discord role-ID
   env var is wired because there is no Discord identity on an account to match
   it against.
5. **Saved-search "tier" filters on a new `offers.tier` column**
   (`free`/`pro`/`elite`, default `free`) — offers had no tier to filter on.
6. **"Minimum commission" needs a number**, but `offers.commission` is free
   text ("18% of contract value"), so offers gain an optional numeric
   `commission_amount` used only for filtering; existing offers leave it NULL
   and simply never match a minimum.
7. **Notifications are a new `notifications` table** with an `/notifications`
   page and an unread count in the header — that is the "in-app notification".
8. **Discord role changes are lazy, not cron.** This stack has no scheduler, so
   the monthly Top Closer award/revoke is evaluated whenever the leaderboard is
   read (first read of a new month awards, first read after month end revokes).
9. **Charts are inline SVG** — no charting dependency added.
10. **Tests:** no test framework existed, so `npm test` runs Node's built-in
    test runner through `tsx` (`node --import tsx --test tests/*.test.ts`) over
    the pure decision logic (matching, limits, eligibility, scoping, ranking).
    Modules import `server-only`, so tests run with `--conditions react-server`
    and never touch a live database.
11. **The brief was truncated** at "Add tests for: partner data". Read as:
    tests must cover partner data isolation, plus each feature's core rules.
12. **No deployment is attempted**, per instruction.
13. **Admins bypass tier/role gates** everywhere (existing convention), so an
    admin also sees Elite-only review comments.
14. **Reps can log results only for offers that accepted them**, the same bar
    as writing a review — otherwise a profile could claim work it never did.
15. **"Average partner rating" is the mean review score of the offers a rep
    worked** (`offer_reviews` has no rep dimension, and adding a second review
    system was out of scope). Shown to one decimal; “—” when unrated.
16. **Earnings ranges are whole US dollars** — no currency column, no
    conversion, since this is a profile range rather than an invoice.
17. **Handles come from the email local part** (backfilled by the startup
    migration), made URL-safe and de-duplicated at signup with `-2`, `-3`
    suffixes. Handles are not unique-indexed; the profile route resolves the
    oldest match, which is adequate for a board of this size.
18. **A view is one member × one offer × one UTC day** (unique index +
    `INSERT OR IGNORE`), so refreshing a page cannot inflate analytics. Admins
    and the offer's own partner are not counted, and analytics charts are
    plain CSS bars rather than a charting dependency (PROGRESS #9).
19. **Deal logs are per offer per month** (`deals.month`, unique
    `(user, offer, month)`), because a monthly leaderboard needs monthly
    attribution; the profile sums all months. Existing logs take their
    creation month. **Ties rank by name**, then user id, so the top-3 cut is
    deterministic.
20. **Whop replaces the earlier Razorpay pricing request.** No Razorpay code
    was written. All card/UPI handling is Whop-hosted; the app only creates
    checkout links and verifies webhooks. The board-level paid flag and its
    legacy checkout-URL setting remain for the Discord channel features.
21. **Founding slots are counted from every row with `founding = 1`, not only
    active ones.** The brief says a canceled founding member does not free a
    slot, so the used count never decreases; `/pricing` therefore can never
    re-open a slot. Founding is monthly only (no founding annual plan was
    specified).
22. **Founding price survives active/past-due subscriptions only.** The
    `founding` flag and slot are kept for history, but `effectiveTier` returns
    `free` for canceled/expired rows, so access ends while the slot stays used.
23. **Explicit INR amounts:** only standard monthly INR was given (₹499 Pro,
    ₹1,299 Elite). Annual INR (₹4,999 / ₹12,999) and founding INR (₹399 /
    ₹899) are explicit config values, never checkout-time conversions.
24. **Webhook mapping is defensive:** `membership.updated` is read by its
    `status` field, `membership.canceled` is treated like
    `membership.deactivated`, and `payment.failed` means `past_due` (dunning)
    rather than an immediate downgrade. The pinned API version is
    `2026-10-24` (`WHOP_API_VERSION`).
25. **The subscription row wins over `users.tier` whenever it exists.** Admin
    tier changes write a `granted` subscription row *and* mirror `users.tier`;
    a later Whop event takes the row back over. Access is checked on every
    request via `getAuthContext`, never from client state.
26. **Billing flags are manual by design.** A founding checkout that loses the
    race is moved to the standard plan and a `founding_overflow` flag appears
    on `/billing`; an admin resolves it after handling the charge in Whop.
27. **Billing tests use real SQLite, not a live D1.** `tests/helpers/memory-d1.ts`
    adapts Node's built-in `node:sqlite` to the D1 surface, so signature
    verification, event idempotency, the founding-slot race and tier
    transitions run against the actual SQL.
28. **No deployment is attempted**, per instruction. The production build was
    run locally to confirm the routes and the SDK bundle compile.
29. **Production publish (2026-10-30), with checkout deliberately off.** The
    brief's no-deployment instruction was later lifted by an explicit request
    to publish. The current build went live on Sites **production** (receipt
    `8acc3578`, `published: true`) carrying only `SESSION_SECRET` and
    `SEED_DEMO_DATA` — no Whop variables — so subscribers can see prices but
    cannot buy until `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, the six
    `WHOP_PLAN_ID_*` and `NEXT_PUBLIC_APP_URL` are added. Verified live:
    `/pricing` 200 with “Founding price: 20 of 20 spots left”, USD/INR toggle
    and all six prices;   `/billing` auth-gated (streaming redirect to `/login`);
   `POST /api/billing/checkout` 401 signed out; `POST /api/webhooks/whop`
   503 `not_configured`. The signed-in “Checkout not configured” button state
   was not exercised — no production account was created for testing.
30. **Live bug sweep and fixes (2026-11-01), deployed to both environments.**
    Probing production route-by-route found three real defects, fixed in
    `fc3db88` and re-verified live after deploying to preview first, then
    production (receipt `076f4850`, still `published: true`):
    - **Auth redirects were inconsistent and lost the return path.** Only
      `/offers`, `/applications` and `/admin` were covered by `proxy.ts`, so
      they redirected cleanly (307 to `/login?next=…`). The other member pages
      (`/billing`, `/deals`, `/notifications`, `/saved-searches`,
      `/reps/[username]`) called `requireMember()` → bare `/login` with no
      `next`, and — because `billing`/`deals`/`reps` wrap the guard in
      `Suspense` — the redirect fired after the shell had streamed, answering
      **HTTP 200 with an inline redirect**. The proxy now covers all of them:
      every gated page answers 307 with `?next=`, and `AuthForm`'s
      `router.replace(safeNext(next))` returns the visitor to where they were.
    - **“Manage or cancel on Whop” showed to members with no subscription**,
      linking (via the `WHOP_MANAGE_URL` default `https://whop.com/hub`) free
      users to an empty Whop hub. The button now renders only when a
      subscription row exists.
    - **No error boundaries.** Added root `error.tsx` (branded retry UI that
      keeps the site shell, logs the error, shows the `digest`) and
      `global-error.tsx` (own `<html>/<body>` with inline theme-matching
      styles, since it replaces the root layout and cannot use global CSS).
      Both compile and typecheck; neither has been triggered live — that needs
      a server error to occur, which was not induced on purpose.
    Checks after the fixes: `npm run typecheck`, `npm run lint`, `npm test`
    (72/72), `npm run build` all clean; live on both environments all eight
    gated paths answer 307 with `?next=`, `/pricing`, `/login`, `/leaderboard`
    stay 200, `/reps` and unknown paths stay 404, `POST /api/auth/login` with
    bad credentials answers 401 `invalid_login`, checkout 401 signed out, and
    the webhook still answers 503 `not_configured` because **the production
    Whop secrets are still not set** (the nine values were to be added in the
    Sites panel; production remains at 3/25 variables). No new product
    features were added: the eight features are complete, and the only
    remaining gap is that configuration, not code. No test accounts were
    created on production — the first signup would become the admin and there
    is no delete-user flow — so signed-in page rendering remains unexercised
    on production.
31. **Perf and header polish (2026-11-02), deployed to both environments.**
    Code `904407f`; preview receipt `a18fd330`, production receipt `79f7b3d5`
    (`published: true`, `deployed_at 2026-11-02T07:40:13Z`).
    - **Slow tabs — what was actually wrong.** Every signed-in page ran the
      auth chain twice (header + page guard: session → user → subscription)
      and the header then ran its notification count and role lookup one
      after the other, so the tab bar waited on ~5–7 sequential D1 round
      trips. `getAuthContext`/`getUserRoles` are now wrapped in React's
      `cache` (the pattern Next's own layout docs recommend for duplicate
      layout/page fetches; a no-op outside a render, so route handlers are
      unaffected), the user and subscription rows are read in parallel (the
      subscription is keyed by the same id the session carries), and the
      header's badge count and role lookup run together. Signed-in tab chain:
      ~5–7 serial stages → 3. Measured 12× per route on preview with a
      member account before and after: steady-state TTFB is ~0.08–0.21s in
      both runs — D1 is fast, so the query dedupe is real but small. The
      perceived slowness is dominated by **intermittent platform spikes of
      0.6–2.8s on document requests**, which reproduce on static CSS fetches
      too and never hit API routes; that is edge/isolate behaviour outside
      this codebase (the incremental cache is already disabled, ruling out
      the R2 cache), reported honestly rather than “fixed”.
    - **Search box overlap (screenshot).** The shared `.input` rule is
      unlayered, so its `padding: .5rem .75rem` outranks Tailwind's layered
      `pl-9` utility and text started at 12px under the 12–28px magnifier.
      Fixed with an `.input-search { padding-left: 2.25rem }` rule after
      `.input` (the same pattern as `.select`'s padding-right); the field now
      uses `input input-search`.
    - **Coeso logo.** The attached artwork was not on disk, so the wordmark
      was recreated as an inline SVG (`src/components/coeso-logo.tsx`: cream
      serif `COESO` in `--font-display` on a `#22333b` rounded tile) and is
      now the header brand and the sign-in card mark, replacing the indigo
      “C” tiles. Drop the real PNG/SVG into `public/` to swap it in.
    - **Tab outlines.** Every nav tab now carries `border
      border-zinc-700/70` (hover `zinc-600`) so each is distinguishable.
    Checks: `npm run typecheck`, `npm run lint`, `npm test` (72/72), build
    green; live on production the logo/outline/search CSS is present in the
    served HTML and CSS, all eight gated paths still 307 with `?next=`,
    `/pricing` `/login` `/leaderboard` 200, `/reps` and unknown paths 404,
    bad login 401, signed-out checkout 401, webhook 503 `not_configured`
    (Whop secrets still not set; 3/25 variables). Signed-in verification
    used two member accounts on **preview only**
    (`perf-admin`/`perf-rep@test.example.com`); production still has no
    accounts — the first signup there becomes the admin.

## Baseline

- Pre-existing uncommitted work (paid-plan Discord gating, admin members +
  settings pages, Whop checkout link, public `/pricing`) committed as
  `feat: paid-plan Discord gating, admin pages and Whop checkout`.

## Features

| # | Feature | Status |
| --- | --- | --- |
| 1 | Saved searches and alerts (Pro/Elite) | done |
| 2 | Offer reviews and ratings (Elite) | done |
| 3 | Report offer and auto-pause | done |
| 4 | Partner portal | done |
| 5 | Rep performance profile | done |
| 6 | Offer analytics (admin + partner) | done |
| 7 | Leaderboard with Discord rewards | done |
| 8 | Whop payments, pricing config and founding slots | done |

### Feature 8 — Whop payments, pricing and founding slots ✅

- **Single pricing config:** `src/lib/pricing.ts` holds `FOUNDING_SLOTS = 20`,
  `WHOP_API_VERSION = "2026-10-24"`, the six plans (Pro/Elite × monthly/annual
  + two founding monthly), explicit USD **and** INR amounts, and the env-var
  name per plan. Changing a price is a one-file edit; standard and founding
  are separate Whop plans so existing founding subscribers are unaffected.
- **Schema:** `subscriptions` (one row per account, unique membership id and
  unique founding slot), `whop_events` (event-id idempotency ledger) and
  `billing_flags` (manual action). All three live in `billing-schema.ts`,
  shared by `d1.ts` and the SQLite tests.
- **Checkout:** `POST /api/billing/checkout` (session-derived user id) uses the
  official `@whop/sdk` `WhopClient` against REST v1, with `metadata.user_id`
  and `redirect_url` set server-side. The browser only receives the
  `purchase_url`. Missing API key/plan id → `503 billing_not_configured`;
  founding requested after the last slot → `409 founding_full`.
- **Webhook:** `POST /api/webhooks/whop` verifies the raw body with the SDK's
  `unwrapWebhook` + `WHOP_WEBHOOK_SECRET` (invalid → `400`), claims the event
  id before processing (duplicate → `200 {duplicate:true}`), releases the
  claim and returns `500` on failure so Whop can retry. Handles
  `payment.succeeded`, `payment.failed`, `membership.activated`,
  `membership.deactivated`/`canceled`, `membership.cancel_at_period_end_changed`
  and `membership.updated` by status.
- **Access:** `getAuthContext` reads the subscription row and overrides
  `users.tier` with `effectiveTier` — active/past_due/granted only. Gated APIs
  and pages therefore drop a canceled member to `free` on the next request.
- **Founding slots:** claimed by one conditional `UPDATE` (count < 20) guarded
  by a partial unique index on `founding_slot`; a loser gets the standard plan
  and a `founding_overflow` flag. The slot is never restored, matching the
  pricing promise.
- **Admin founding grant:** `/billing` also has “Grant founding slot”, which
  consumes a slot with the same atomic claim and then grants the selected tier
  (admin override), for comps and for fixing an overflowed checkout.
- **UI:** `/pricing` shows live “Founding price: X of 20 spots left”, USD/INR
  toggle (INR defaults from `cf-ipcountry`), standard plans automatically when
  full, and a Whop checkout button per plan. `/billing` shows plan, status,
  period end, founding slot, manage/cancel link, admin manual grant and open
  flags, plus an admin subscription table. Header gained “Billing”.
- **Docs:** `.env.example` has every Whop variable; README has the step-by-step
  dashboard, plan, API key, webhook, tunnel and founding-slot walkthrough.
- **Admin consistency:** `/admin/members` now shows the *effective*
  subscription tier (falling back to `users.tier` for accounts that never
  subscribed), so a webhook upgrade or cancellation is visible there too.
- **Sandbox smoke test:** `npm run smoke:whop` creates a real sandbox checkout
  (unless `--skip-checkout`), posts a correctly signed `payment.succeeded` to
  the running webhook route, replays it for the duplicate no-op, and reads
  `/billing` as the throwaway member to confirm the plan and status rendered.
  It refuses production checkout without `--allow-production` and never prints
  secrets. Locally (no Whop key) the `--skip-checkout --create-user` path
  passed: webhook `200 ok`, replay `200 duplicate`, billing showed “Pro
  monthly” and “Active”.
- **CI job:** `.github/workflows/whop-smoke.yml` boots a disposable instance
  with `wrangler.ci.jsonc` (bindings-only, fresh local D1) and runs the same
  script. `WHOP_WEBHOOK_SECRET` and the selected plan's `WHOP_PLAN_ID_*` are
  always required (the event must map to a tier); with `WHOP_API_KEY` it also
  creates a real sandbox checkout, and without it runs the webhook-only path.
  Manual dispatches fail fast on a missing required secret; scheduled/push runs
  skip with a warning. An `app_url` dispatch input targets an existing sandbox
  deployment instead. The preflight branches, the disposable boot and the smoke
  path were exercised locally, and the workflow YAML was validated; it has not
  run on GitHub Actions from this environment.
- **Tests (14 new, real SQLite via `node:sqlite`):** config integrity and
  explicit amounts, entitlement/status rules, gated tier limits, SDK signature
  acceptance + rejection (wrong signature, tampered body, stale timestamp),
  duplicate event idempotency + release-on-failure, the two-way race for slot
  20, renewal/cancel/failed-payment transitions, standard and founding webhook
  handling, overflow flagging, admin grant, effective-tier admin listings.
  **Total suite: 72 tests.**
- **Checks:** `npm test` 72/72, `npm run typecheck`, `npm run lint` and
  `npm run build` all clean.

### Feature 7 — Leaderboard with Discord rewards ✅

- **Schema:** `deals.month` (`YYYY-MM`) with the unique index changed to
  `(user_id, offer_id, month)`; `leaderboard_awards` (one row per month per
  winner, `role_granted`, `revoked_at`). Existing logs are backfilled from
  `created_at`.
- **Rules (pure, tested):** `currentMonth` (UTC), `previousMonth` (year
  rollover), `monthLabel`, `isValidMonth`, `rankEntries` (deals desc, name
  tiebreak), `awardsToRevoke` (earlier month + not yet revoked), `shouldAward`
  (once per month, only when somebody closed a deal).
- **Award job (lazy — PROGRESS #8):** `syncLeaderboardAwards` runs on every
  `/leaderboard` read: revokes earlier months' roles via the existing
  `setGuildRole`, records this month's top three (unique index makes it
  idempotent), sends each a in-app “Top Closer” notification, and retries the
  Discord grant for winners whose role didn't take. Without
  `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `TOP_CLOSER_ROLE_ID` (or a
  `users.discord_id`) the role step is skipped and the in-app notice remains.
- **UI:** `/leaderboard` with the current month's ranking (Top Closer badges,
  viewer's position), the previous month's winners and whether their role was
  returned; “Leaderboard” header link. `/deals` gained a month field and shows
  each log's month.
- **Checks:** `npm test` 58/58, `npm run typecheck`, `npm run lint` clean.

### Feature 6 — Offer analytics ✅

- **Schema:** `offer_views` with a unique `(offer_id, viewer_id, viewed_on)`
  index; applications and their accepted status come from the existing
  applications table, so no denormalised counters can drift.
- **Rules (pure, tested):** `lastNDays` (UTC, oldest first), `buildSeries`
  (zero-fills quiet days), `acceptanceRate` (one decimal, null with no
  applicants), `barPercent` (chart scaling, 2% floor for non-zero days),
  `canViewAnalytics` (admin → all, partner → own offers only).
- **API/data:** `recordOfferView` called from the offer detail page for
  members other than admins and the owning partner; `listOfferAnalytics`
  (one SQL row per offer with correlated counts) and `getOfferAnalytics`
  (totals + 30-day series).
- **UI:** `/admin/analytics` table (views, applications, acceptance rate) and
  `/admin/analytics/[id]` with stat tiles plus a 30-day views/applications
  chart (`AnalyticsChart`, CSS bars). New “Analytics” tab, visible to partners.
  Ownership is checked in the page before any numbers load, and a partner's
  list query is narrowed by `partner_id`.
- **Checks:** `npm test` 50/50, `npm run typecheck`, `npm run lint` clean.

### Feature 5 — Rep performance profile ✅

- **Schema:** `deals` (one row per rep per offer via a unique index) with
  `deals_closed`, `earnings_min`/`earnings_max`, `partner_confirmed_at/by`;
  `users.username` (profile handle) and `users.hide_earnings`. Usernames are
  backfilled from the email local part on startup.
- **Rules (pure, tested):** `slugifyHandle` / `uniqueHandle` / `handleFromEmail`,
  `earningsVisible` (rep + admins always see it), `summariseDeals` (deal total,
  offers worked, confirmed count, summed range or null), `averageRating`,
  `canConfirmDeal` (owning partner or admin only).
- **API:** `POST /api/deals` upserts the signed-in rep's log and requires an
  accepted application (assumption 14); editing clears an earlier partner
  confirmation. `DELETE /api/deals/[id]` is owner-scoped.
  `POST /api/deals/[id]/confirm` lets only the offer's partner (or an admin)
  confirm, with a 404 for anyone else. `PATCH /api/profile` toggles
  `hideEarnings`.
- **UI:** `/deals` (log/edit/delete, earnings range, hide-earnings switch,
  link to the public profile), `/reps/[username]` (deals closed, offers
  worked, partner rating, earnings when visible, confirmed badges), and a
  “Deals reported” section with Confirm buttons on the owning offer's
  applicants page. Header gains “My deals”.
- **Checks:** `npm test` 45/45, `npm run typecheck`, `npm run lint` clean.

### Feature 4 — Partner portal ✅

- **Schema:** `offers.partner_id` (NULL = admin-authored) and
  `offers.approval_status` (`approved | pending | rejected`, default approved
  so legacy rows stay public). Both added as guarded `ensureColumn` calls plus
  the reference copy in `db/schema.sql`.
- **Role:** `partner` slug in the existing `user_roles` table, admin-assigned
  (PROGRESS #4). `/admin/members` now has a one-click “Grant partner access”
  button alongside the free-text role picker.
- **Rules (pure, tested):** `canManageOffer` (admin → any offer; partner →
  only offers whose `partner_id` is their own; losing the role loses access
  to old offers), `canViewOfferApproval` (approved = public, pending/rejected
  = admin or owner only, so a submission is a 404 for everyone else),
  `canApproveOffers`, `toApprovalStatus`, `approvedOffersClause`.
- **API:** `POST /api/offers` accepts staff — a partner submission is forced
  to `approval_status = 'pending'`, `featured = false`, no role gate, and is
  never announced. `PATCH /api/offers/[id]` checks ownership (404 for another
  partner's offer) and rejects `featured`/`requiredRole` from partners.
  `POST /api/admin/offers/[id]/approval {action}` is admin-only; approving is
  the moment the Discord announcement and saved-search alerts fire.
  `PATCH /api/admin/applications/[id]` now scopes partners to applications
  on their own offers, and `GET`/apply on a pending offer is a 404.
- **UI:** partner-aware dashboard (own offers + own stats only, pending counts,
  approve/reject buttons for admins), partner-aware edit/applicants pages with
  ownership checks, “Verified Partner” badge on approved partner offers (card
  + detail), partner submit copy and no admin switches in the offer form,
  admin nav hides admin-only tabs from partners.
- **Isolation tests:** `tests/partners.test.ts` (10 tests) covers admin vs
  owner vs other-partner vs ordinary-member access, demoted partners, pending
  visibility and the public SQL clause. **Total suite: 37 tests.**
- **Checks:** `npm test` 37/37, `npm run typecheck`, `npm run lint` clean.

### Feature 3 — Report offer and auto-pause ✅

- **Schema:** `offer_reports` with a unique `(offer_id, reporter_id)` index
  (that is what makes the reports *unique*), status `open | dismissed`.
- **Rule (pure, tested):** `shouldAutoPause(status, openCount)` — pauses only
  a currently-open offer at `REPORT_THRESHOLD = 3` open reports; dismissing a
  report lowers the count again (assumption: dismissed reports don't count).
- **API:** `POST /api/offers/[id]/report` (reason validated 5–500 chars, second
  report from the same member → 409 `already_reported`); on the third, the
  offer is paused in SQL and admins get an in-app notification each plus one
  Discord webhook embed (`announceReport`). `GET /api/admin/reports` and
  `PATCH /api/admin/reports/[id] {action:"dismiss"}` are admin-only; closing
  the offer reuses the existing offer PATCH.
- **UI:** "Report this offer" inline form on the offer page (aside), new
  `/admin/reports` page (reasons, reporter, offer status, dismiss/close/view)
  with a "Reports" tab on the admin bar.
- **Note (documented behaviour):** `announceReport` posts whenever *any*
  webhook URL is configured (settings or `DISCORD_WEBHOOK_URL` env), even on
  the free plan — moderation notices are operational, not the paid feature.
- **Checks:** `npm test` 27/27, typecheck + lint clean. Committed as
  `feat: offer reports with automatic pause and admin review`.

### Feature 2 — Offer reviews and ratings (Elite) ✅

- **Schema:** `offer_reviews` (3 ratings 1–5 + optional comment) with a
  unique `(offer_id, user_id)` index — one review per user per offer is
  enforced by the database, not just the API.
- **Rules (pure, tested):** `reviewEligibility()` — an accepted application is
  required of *everyone* (admins included: eligibility is the feature),
  writing additionally requires the Elite tier with the usual admin bypass;
  `summariseReviews()` — per-dimension + overall averages, one decimal.
- **API:** `GET/POST /api/offers/[id]/reviews`. GET returns the summary to
  anyone who can see the offer, plus `comments: null` (not an empty list) for
  non-Elite viewers so the gated field is simply absent from the payload;
  duplicate reviews answer 409 `already_reviewed` (API check + unique index
  caught via `isDuplicateReviewError`).
- **UI:** `<OfferReviews>` on the offer detail page — star averages for payout
  reliability / lead quality / support, comments (Elite/admin only), and a
  form shown only to eligible non-reviewers, with tier/eligibility copy for
  everyone else.
- **Checks:** `npm test` 23/23, typecheck + lint clean. Committed as
  `feat: offer reviews and ratings (Elite)`.
- **Note:** test runner now uses `--conditions react-server` so `server-only`
  modules load under Node (PROGRESS #10 made this explicit).

### Feature 1 — Saved searches and alerts (Pro and above) ✅

- **Schema:** `saved_searches`, `notifications`; new columns `users.tier`,
  `users.discord_id`, `offers.tier`, `offers.commission_amount` (guarded
  `ensureColumn` ALTERs, plus the reference copy in `db/schema.sql`).
- **Rules:** `src/lib/tiers.ts` (pure: rank, `savedSearchLimit` 0/5/15,
  `viewerCanUse`) and `src/lib/matching.ts` (pure: role/tier/keywords/min-
  commission matching over open offers only).
- **API:** `GET/POST /api/saved-searches`, `PATCH/DELETE /api/saved-searches/
  [id]` (owner-scoped), `GET/POST /api/notifications` (mark one / mark all),
  `PATCH /api/admin/members/[id]/tier` (admin assigns tiers — assumption 3).
  Create enforces the tier gate (403 `tier_required`) and the per-tier limit
  (403 `limit_reached`) server-side.
- **Alerts:** `alertSavedSearches(offer)` runs after a publish (`POST
  /api/offers`) and on re-open (`PATCH /api/offers/[id]`): one in-app
  notification per matching user, plus a best-effort bot DM that is skipped
  without `DISCORD_BOT_TOKEN`/`DISCORD_GUILD_ID`/`users.discord_id`.
- **UI:** `/saved-searches` (create/edit/delete, usage counter, Pro upsell card
  for free members), `/notifications` (+ "Alerts" header link with an unread
  badge), admin tier picker on `/admin/members`, tier + commission-amount
  fields on the offer form.
- **Checks:** `npm test` 17/17 (tier rules + matching), `npm run typecheck`,
  `npm run lint` all clean. Committed as `feat: saved searches, alerts and
  member tiers (Pro/Elite)`.
- **Bug fixed during F1:** two of my own test expectations were wrong (a
  "both"-role search should *not* match a setter-only offer; a keyword-mismatch
  case was overriding the offer's keywords instead of its text) — corrected the
  tests, not the code.

### Offers Board — invite-only access and admin dashboard ✅

- **Model:** the standalone `offers-board/` project no longer has a public
  board or a single shared admin password. There is one owner admin account
  plus view-only member accounts the admin creates; there is no sign-up.
- **Schema:** `accounts` (unique case-insensitive username, scrypt hash, role
  `admin`/`viewer`, active flag, last_login_at). The owner admin is seeded once
  from `ADMIN_USERNAME`/`ADMIN_PASSWORD`; later env changes do not reset it.
- **Sessions:** HMAC-signed `coeso_offers_session` cookie (httpOnly,
  SameSite=Lax, 7 days), verified against the account row on every request, so
  disabling or deleting an account revokes access immediately.
- **Gate:** `/offers` and `/offers/[id]` live behind a layout that redirects to
  `/login`; reads require a session; every write requires `role = admin`.
- **Login copy:** states access is invite-only and asks people to contact
  Coeso's Owner (`a1rymn`) on Discord, with a second notice for offer owners
  who want their offers posted.
- **Admin dashboard (`/admin`):** stats, post offer, offers table (edit,
  close/reopen, delete), account manager (create with one-time password, reset
  password, disable/enable, delete, last-admin and self guards), applications.
- **Removed:** `/offers/admin`, `/api/admin/*`, the password-only login, and the
  public application form (members are view-only).
- **Bug fixed:** `node:sqlite` returns null-prototype rows, which React refuses
  to pass to a Client Component (`/admin` 500). Rows are now copied to plain
  objects in `lib/db.ts`.
- **Checks:** typecheck + build clean; 20 HTTP checks against `next dev`:
  anonymous redirect, login page copy, admin login, viewer login, viewer
  blocked from `/admin` and every write API, admin offer create/edit/
  close/reopen/delete, account create/reset/disable/delete, old password
  rejected after reset, disabled session redirected, self-delete/disable
  guarded.

### Offers Board — members can apply ✅

- **Model change:** members are no longer view-only. A signed-in member applies
  to a single offer from its page; the applicant identity (account id and
  username) comes from the session, never the request body. Nobody can apply
  anonymously or to a closed offer, and a second application to the same offer
  is rejected — members still cannot create/edit offers or see other members'
  applications.
- **Schema:** `applications` gained `account_id` (references `accounts`, `ON
  DELETE SET NULL`) and `account_username`, so an application survives the
  member's account being deleted while the admin can still see who applied.
  Existing databases are migrated by a `PRAGMA table_info` guard that ALTERs
  the two columns in.
- **API:** `POST /api/offers/[id]/apply` (session required; 401 anonymous, 404
  unknown offer, 409 closed or already applied, 400 invalid fields) and
  `PATCH /api/applications/[id] {status}` (admin only, `new`/`reviewed`).
- **UI:** the offer page's sidebar now carries a compact apply form (email,
  Discord, experience, hours per week, optional message) instead of pointing
  people at Discord, and switches to an "Application received" state once the
  member has applied. The admin dashboard's applications table shows the member
  username, their message, the status, and a "Mark reviewed" / "Mark new"
  toggle.
- **Checks:** `npx tsc --noEmit` and `next build` clean (17 routes, including
  both new ones). HTTP checks against `next start` on a throwaway SQLite file:
  anonymous apply 401; member apply 201; duplicate 409; invalid body rejected;
  closed offer 409; unknown offer 404; member reading applications 401; member
  PATCH of an application 401; admin sees the application with the member's
  username and marks it reviewed 200; bad status 400; offer page shows the form
  before applying and "Application received" after; `/admin` renders the member
  and the review toggle; anonymous offer page still 307 to `/login`. Test
  accounts and the temp offer were deleted afterwards; the probe database was a
  separate file, so the local `.data/offers.db` was untouched.

### Offers Board — public deployment on Freebuff Sites ✅

- **Live:** production `https://coeso-offers-board-gzjzfv.freebuff.site`,
  preview `https://coeso-offers-board-gzjzfv-preview.freebuff.site`. Both are
  published; production runs with `SEED_DEMO_DATA=false` (empty board), preview
  keeps the demo offers.
- **Why a new site:** the older "Coeso Offers Board" site hosts the root app's
  D1 database, whose `offers`/`applications` tables have a different schema.
  The board got its own site (`b3f6c1d2-…`) with one D1 database per environment
  bound as `DB`, so nothing touches live data and no schema archaeology was
  needed.
- **Runtime migration (required to run on Workers):**
  - `lib/db.ts` now reads the `DB` D1 binding through `getCloudflareContext`
    instead of `node:sqlite` behind Turso credentials. `next dev` gets the same
    binding via `initOpenNextCloudflareForDev`, scoped to development because
    the call starts workerd and broke the deploy build.
  - `lib/password.ts` moved from `node:crypto` scrypt to Web Crypto PBKDF2.
    **Cloudflare caps PBKDF2 at 100,000 iterations** ("iteration counts above
    100000 are not supported" was the exact production error behind a 500 on
    every login), so the constant is 100k — the Workers ceiling.
  - `lib/store.ts` splits schema creation into tables → column migration →
    indexes, because D1 has no `PRAGMA table_info`; a duplicate-column error is
    the "already applied" signal.
- **Checks:** local workerd (`wrangler dev` with a fresh D1) exercised schema
  bootstrap, demo seed, admin dashboard, offer create, account create, member
  login, member blocked from `/admin` (307), apply with session attribution,
  admin review list, and a 401 for a bad password. On production over HTTPS:
  `/login` 200 with the invite-only copy, anonymous `/offers` → 307 `/login`,
  bad login 401, admin login 200, `/admin` 200, empty-board copy rendered,
  offer create 201 → offer page 200 → delete 200 (probe removed), anon
  `/api/accounts` 401. Secrets set as `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
  `ADMIN_SECRET`, `SEED_DEMO_DATA`; the temporary secret files were deleted.
- **Note on local builds:** this workspace path is too long for workerd's
  SQLite, so `sites_prepare_next` completes its Next/Worker build and manifest
  generation and then fails while seeding the local preview cache. The deploy
  uses the generated `freebuff-sites-build/manifest.json`.
