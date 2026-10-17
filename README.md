# Roster by Coeso

A multi-tenant SaaS for agencies and communities to manage a roster of sales
reps, post client offers, and place reps on those offers. Each workspace = one
agency/community; every decision in the schema and the code assumes many
isolated tenants. The first tenant is Cooeso (workspace #1); the product is
sold to other communities afterwards.

**Status:** phases 1–7 are implemented — backend foundation (1),
frontend (2), invites / CSV import / rep portal (3), billing (4), Discord
integration + reports + white-label (5), skills, profiles & smart matching (6),
and performance, commissions & payouts [PRO] (7). See "What was built per
phase" below.

## Stack

| Layer | Tech |
| --- | --- |
| Backend | Java 21, Spring Boot 3.5, Spring Security (JWT), Spring Data JPA/Hibernate 6.6, Flyway, MySQL 8, Maven |
| Frontend | React + TypeScript + Vite, React Router, TanStack Query, plain CSS |
| Discord | JDA bot in the backend JVM (notifications), Discord REST via `RestClient` (OAuth + role sync) |
| Billing | Stripe (implemented), Razorpay (documented stub) behind a `BillingProvider` interface |
| Tests | JUnit 5 + Testcontainers (MySQL), MockMvc; Vitest + Testing Library for the frontend |

## Repository layout

```
backend/            Spring Boot application (Maven)
  src/main/java/com/coeso/roster/
    auth/           register, login, JWT issue/verify
    billing/        BillingProvider (stripe/razorpay), checkout, webhooks
    common/         TenantContext, Hibernate filter wiring, role guard, errors
    config/         security configuration
    discord/        OAuth login, role sync, JDA notifier, guild settings
    entity/         JPA entities + tenant base classes
    invite -> workspace/  invites (create/list/revoke/preview/accept)
    lookup/ offer/ placement/ plan/ purge/ rep/ reports/ stats/
    match/          pure match scorer + "suggested reps" service (Phase 6)
    performance/    activity log, earnings ledger, payouts, commission rules,
                    leaderboard (Phase 7, all [PRO])
    commission/     pure commission math (percent / flat / tiered)
    workspace/      workspace lifecycle, membership, default seeding
    audit/          audit_log writer + /api/audit activity feed
  src/main/resources/db/migration/   Flyway migrations (V1 schema, V2 plans,
                                     V3 discord login, V4 skills & profiles,
                                     V5 performance & commissions)
  src/test/                         integration test suites
frontend/           React + TypeScript + Vite app
  src/pages/        login/register, workspace picker, roster, offers, reports,
                    performance (Phase 7), settings (lookups, billing,
                    branding, discord, metrics)
  src/test/         vitest suites
start-dev.sh        one-command stack: MySQL + backend + frontend + tunnel
docker-compose.yml  MySQL 8 for local development
.env.example        all environment variables, documented
```

## Quick start

Prerequisites: JDK 21, Maven, Node 20+, Docker (or a local MySQL 8).

```bash
# one command: MySQL + backend + frontend + public share tunnel (idempotent)
./start-dev.sh
```

The script skips anything already running, waits for each component to be
ready, prints the public `*.trycloudflare.com` URL for sharing, and logs
everything to `logs/*.log`. `cloudflared` must be on `PATH` (or
`CLOUDFLARED=/path/to/cloudflared`) for the tunnel; everything else still
starts without it. Manual equivalent:

```bash
cp .env.example .env
docker compose up -d          # starts MySQL 8 on :3306 (user/pass: roster/roster)

# backend (Flyway migrates on boot)
cd backend && mvn spring-boot:run        # http://localhost:8080

# frontend (separate shell; Vite proxies /api to :8080)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Billing and Discord features need keys — see `.env.example`; everything works
without them (checkout and Discord login answer 503 with a clear code until
configured, webhooks are rejected, notifications are dropped).

## Running the tests

```bash
# backend
cd backend
mvn test                            # full suite (92 tests)
mvn test -Dtest=Phase7PerformanceTest        # one class

# frontend
cd frontend
npm test                            # vitest (33 tests)
npx tsc --noEmit                    # typecheck
```

- With Docker available, backend tests use **Testcontainers MySQL 8** (fresh
  container per run, schema built by Flyway).
- Without Docker they fall back to the external MySQL given by
  `ROSTER_TEST_DB_URL` (same engine; the schema is wiped and re-migrated when
  migrations change).

## How tenant isolation works

Four independent layers, each of which would stop a cross-tenant access on its
own:

1. **Workspace resolution from membership, never from the request.**
   `TenantFilter` reads the `X-Workspace` header (id or slug) or the request
   subdomain, looks up the authenticated user's membership, and populates the
   request-scoped `TenantContext` (workspace id, role, actor user id). A
   non-member gets 403 before any controller code runs. Nothing downstream
   accepts a workspace id from a body or query parameter.

2. **A Hibernate `@Filter` on every tenant-owned table.** `TenantEntity` (the
   mapped superclass carrying `workspace_id`) declares the shared filter; every
   tenant entity re-declares the `@Filter` with its own condition. The
   `TenantAspect` opens the service-layer transaction (READ COMMITTED) and
   enables the filter with the current workspace **before** any service method
   body runs — so no repository or JPQL query can execute unscoped. Identifier
   lookups go through `ScopedQueries` (JPQL, not `findById`).

3. **Database-level safety.** Every tenant table has `UNIQUE (workspace_id, id)`
   and **composite foreign keys** such as `placements (workspace_id, offer_id)
   -> offers (workspace_id, id)`. Even if application code were bypassed, MySQL
   itself rejects a row that links to another tenant's row. Global tables (no
   `workspace_id`) are only `plans` and `users`.

4. **Role checks in the service layer.** Roles (`owner > admin > manager > rep`)
   are per-workspace and dynamic, so they come from the membership resolved per
   request. Service methods are guarded with
   `@PreAuthorize("@roles.hasAtLeast('MANAGER')")` etc.; the guard throws
   precise status codes (400 without a workspace, 403 for a too-low role).

### Placement rules (rule 3 and 4)

- `placements.active_rep_id` is a **generated column** (`rep_id` when
  `status = 'active'`, else `NULL`) with `UNIQUE (workspace_id, active_rep_id)`
  — the database itself enforces at most one active placement per rep.
- Placing a rep runs in **one transaction**: `SELECT ... FOR UPDATE` on the
  offer row → check offer is open and has a free seat → insert placement →
  insert `audit_log` row → best-effort Discord notification. Two concurrent
  attempts for the last seat serialize on the row lock; exactly one succeeds
  (verified by a race test).
- Every create / update / delete / place / unplace writes an `audit_log` row in
  the same transaction as the change.

## REST API

All workspace-scoped endpoints require `Authorization: Bearer <token>` and
`X-Workspace: <id-or-slug>` (or a subdomain host).

| Area | Endpoints | Min role |
| --- | --- | --- |
| auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | authenticated |
| discord auth | `GET /api/auth/discord/url`, `POST /api/auth/discord` (`{code}`) | public |
| workspaces | `GET /api/workspaces`, `POST`, `DELETE /{id}` | any member / any user / owner |
| branding | `GET /api/workspaces/branding`, `PUT /api/workspaces/branding` | read: any member; write: admin+ |
| invites | `POST/GET /api/invites`, `DELETE /api/invites/{id}`, `GET /api/invites/preview?token=`, `POST /api/invites/accept` | admin+ (accept: any authenticated) |
| reps | `GET /api/reps` (filters `q`, `verticalId`, `statusId`, `experienceId`, `placed`, `page`, `size`), `GET /api/reps/export` (same filters, CSV), `POST`, `PUT /{id}`, `DELETE /{id}` (soft) | manager+ |
| rep csv | `POST /api/reps/import/preview`, `POST /api/reps/import` | manager+ |
| rep portal | `GET /api/me/rep`, `GET /api/me/placement`, `GET /api/me/open-offers` | any member |
| clients | `GET/POST /api/clients`, `PUT/DELETE /{id}` | manager+ |
| offers | `GET /api/offers` (filters `q`, `verticalId`, `effectiveStatus`), `POST`, `PUT /{id}`, `POST /{id}/close` | manager+ |
| placements | `POST /api/placements`, `POST /api/placements/{id}/end`, `GET ?offerId= / ?repId=` | manager+ |
| placement requests | `POST /api/placement-requests`, `GET ?status=`, `POST /{id}/approve`, `POST /{id}/decline` | create: any member (rep: own profile only); decisions: manager+ |
| lookups | `GET/POST /api/verticals`, `/statuses`, `/experience-levels`, `PUT/DELETE /{id}` | read: any member; write: admin+ |
| stats | `GET /api/stats` | manager+ |
| reports | `GET /api/reports` (placement rate, avg bench days, placements per offer, per-vertical breakdown) | manager+ |
| audit | `GET /api/audit` (`page`, `size`) — recent-activity feed from `audit_log`, newest first | manager+ |
| discord settings | `GET/PUT /api/discord/settings` (guild id, notification channel, role map) | admin+ |
| billing | `GET /api/billing/plans`, `GET /api/billing/subscription`, `POST /api/billing/checkout` (owner), `POST /api/billing/plan` (owner), `POST /api/billing/webhooks/stripe` (public, signature-verified) | as noted |
| skills & languages (P6) | `GET /api/skills`, `GET /api/languages`; `POST /api/skills`, `DELETE /api/skills/{id}` | read: any member; write: admin+ |
| rep profile (P6) | profile fields on the reps API (`bio`, `timezone`, `hoursPerWeek`, `availableFrom`, `skills[]`, `languages[]`, `preferredVerticalIds[]`); roster filters `skillId`, `language`, `available` | manager+ |
| rep photo (P6) | `POST /api/reps/{id}/photo` (multipart, image only, 2 MB cap), `GET /api/reps/{id}/photo` (authenticated bytes) | write: manager+; read: any member |
| suggested reps (P6) | `GET /api/offers/{id}/suggested?limit=` — ranked 0–100 with the per-factor "why" breakdown | manager+ |
| metric types (P7) | `GET /api/metric-types`; `POST`, `PUT /{id}`, `DELETE /{id}` (blocked while entries use it) | read: any member; write: admin+ |
| activity log (P7) | `GET /api/activity/meta` (caller's loggable placements); `GET /api/activity` (`placementId`, `repId`, `metricTypeId`, `from`, `to`, `page`, `size`); `POST`, `PUT /{id}`, `DELETE /{id}` | create: manager+ for any placement, rep for their own; edit: manager+ always, rep own rows within 7 days; delete: manager+ (never once earnings accrued) |
| earnings ledger (P7) | `GET /api/earnings` (`repId`, `status`, `from`, `to`; reps are clamped to their own rows server-side); `POST /api/earnings/{id}/approve` | read: any member; approve: manager+ |
| payouts (P7) | `GET /api/payouts`, `POST` (one rep per batch, approved entries only, one currency), `GET /api/payouts/export` (CSV) | manager+ |
| commission rules (P7) | `GET /api/commission-rules`, `POST` (upsert by scope), `DELETE /{id}` | manager+ |
| leaderboard (P7) | `GET /api/leaderboard` (`period` = week/month/quarter, or custom `from`/`to`; `metricTypeId`) | any member (names masked per the workspace setting) |
| workspace settings | `GET/PUT /api/workspaces/settings` (`leaderboardShowNames`) | read: any member; write: admin+ |

Every Phase 7 endpoint is **[PRO]**: on the free plan it answers `402` with
`code: PRO_FEATURE_REQUIRED` and a message that names the upgrade, and the UI
replaces the surface with an upgrade notice linking to `/pricing`.

Plan limits (`max_reps`, `max_members`) are enforced in the service layer and
answer `402` with `code: PLAN_LIMIT_EXCEEDED` and
`details: {resource, current, limit}`. Seeded plans: free (10 reps / 3
members), starter (50/10), pro (250/50), unlimited (no limits).

Error envelope for every failure:

```json
{ "status": 409, "code": "CONFLICT", "message": "Offer is full (1/1 seats filled)", "details": null }
```

## Roster intelligence & smart matching (Phase 6)

- **Bench clock:** the reps API returns `benchDays` — days since the last
  placement ended, else the joined date, else row creation (`null` while
  placed) — computed at query time, never stored. Roster cards render it as a
  pill that turns red past two weeks, and it feeds the reports' average bench
  time.
- **Rep profiles:** skills (per-workspace tag list, created as you type),
  languages, IANA timezone, weekly availability (hours per week +
  available-from date), preferred verticals, a short bio, and a profile photo
  (multipart upload, image types only, 2 MB cap; served through the
  authenticated photo endpoint so avatars never leak across tenants).
- **Offer requirements:** required skills, required experience level, required
  language, a UTC timezone window (minutes from UTC, wraps midnight), and a
  start date. Shown as chips on the offer card.
- **Smart matching:** `GET /api/offers/{id}/suggested` ranks every available
  rep 0–100 with a transparent weighted breakdown (pure, unit-tested scoring
  service — no I/O):

  | factor | weight | rule |
  | --- | --- | --- |
  | vertical | 20 | offer vertical = rep's primary or preferred vertical; full marks when the offer sets none |
  | skills | 24 | pro-rated overlap of required skills (case-insensitive); full when none required |
  | experience | 16 | rep level rank ≥ required: full; one rank below: half; else 0 |
  | language | 8 | required language among the rep's languages; full when none required |
  | timezone | 8 | rep's UTC offset at the start date falls inside the offer's window; 0 if the rep has no timezone |
  | availability | 16 | available-from ≤ start date (unset = immediately); full when no start date |
  | performance | 8 | past performance — reserved for Phase 7 data; excluded from the denominator until then |

  A factor with no requirement scores full and says so; the final score is
  `round(100 × points ÷ applicable weight)`, clamped to 0–100. Each factor
  returns its points, weight and a human-readable "why" so the UI can always
  explain a score. One click on a suggested rep places them through the normal
  transactional placement code.
- **Roster filters:** by skill, language and availability, combined with the
  existing vertical/status/experience/placed filters; the same filters drive
  the CSV export.
- **CSV export:** `GET /api/reps/export` streams the roster in exactly the
  columns the CSV import recognizes, honouring the same filters (manager+), so
  an export can be edited in a spreadsheet and re-imported unchanged
  (round-trip tested).
- **Activity feed:** `GET /api/audit` pages the workspace's `audit_log`
  newest-first with actor display names resolved server-side (manager+); the
  Reports page renders it with relative timestamps and a "Load older" pager.

## Performance, commissions & payouts (Phase 7, [PRO])

All of this sits behind the workspace's plan: on the free plan every endpoint
below answers `402 PRO_FEATURE_REQUIRED` and the UI shows the upgrade notice.

- **Metric types:** per-workspace vocabulary for activity (seeded with Calls,
  Meetings, Deals closed, Revenue generated; add custom ones in Settings —
  admin+). Unit is `count` or `currency`; money is always stored as integer
  minor units plus a currency code, never floats.
- **Activity logging:** entries are per placement: date, metric, value,
  optional notes, logged-by. Managers can log against any placement and edit
  anything; reps only for their own linked rep, and can edit their own rows
  only within 7 days of the entry date (precise 403s otherwise). Deletes are
  manager+ and blocked once earnings have accrued (edit instead).
- **Earnings ledger:** logging revenue reconciles an append-only ledger —
  entries accrue automatically under the resolved commission rule. The ledger
  is never edited in place: corrections append **reversing entries**, paid
  rows can never be reversed, and no HTTP route mutates a ledger row (tested).
  Statuses: `accrued → approved → paid`. Reps only ever see their own rows
  (clamped server-side; asking for another rep's id is a 403).
- **Commission rules:** scoped by (offer, rep) — workspace default =
  (null, null), per-offer = (offer, null), rep override = (null, rep); the
  most specific wins at resolve time. Rule kinds:
  - `percent` — basis points of logged revenue (`rate_bp`: 1000 = 10%),
  - `flat` — a fixed minor-unit amount per qualifying entry,
  - `tiered` — a list of `{upToMinor, rateBp}` bands where each band's rate
    applies to the revenue inside that band (the last band may be open-ended).
  All math is pure integer arithmetic in `CommissionMath`, unit-tested
  including tier boundaries and remainder splitting.
- **Payouts:** managers batch **approved** entries into a payout record —
  one rep and one currency per batch — with a paid date and reference note;
  entries flip to `paid` and link the payout. `GET /api/payouts/export`
  streams the batch as a CSV run sheet. No real payment processing.
- **Leaderboard:** top reps by period (week / month / quarter / custom range)
  and metric, computed server-side. Reps always see their own rank; whether
  they see other reps' **names** is the workspace setting
  `leaderboardShowNames` (Settings, admin+; masked server-side when off). A
  compact widget lives on the Reports dashboard.
- **UI:** a Performance page with a daily trend chart, per-metric totals and
  the activity log (manager+ can edit/delete inline; the log-entry modal
  converts typed major units to integer minor units); an Earnings tab over
  the same ledger; manager-only Payouts and Commission-rules tabs; the
  leaderboard with period chips and a metric picker.

## Discord integration (Phase 5)

- **Login with Discord** (`GET /api/auth/discord/url` → redirect →
  `POST /api/auth/discord`): the authorization code is exchanged against
  Discord; the account's email links to an existing user or creates one with
  no password. Unconfigured OAuth answers `503 DISCORD_NOT_CONFIGURED`.
- **Role sync on login:** each workspace may store a `workspace_discord` row
  (guild id, notification channel, `role_map` = Discord role id → workspace
  role). On login the member's guild roles are fetched (bot token) and the
  highest mapped workspace role is written to the membership, with an audit
  row. **Owner is never granted or revoked this way** — mappings that target
  owner are ignored at save time *and* at sync time, and owner memberships are
  never touched (tested).
- **Notifications:** a JDA bot (in the backend JVM — no separate service to
  deploy or monitor) posts to the configured channel when a rep is placed, an
  offer is opened, or a placement request arrives. Every send is best-effort:
  a failing bot logs a warning and the primary transaction still commits
  (tested with a throwing stub).
- **White-label:** `logo_url`, `accent_color`, `custom_domain` on the
  workspace; the frontend applies the accent color as the `--accent` CSS
  variable and shows the logo in the header.

## Billing (Phase 4)

`BillingProvider` interface with a Stripe implementation and a documented
Razorpay stub, selected by `BILLING_PROVIDER`. Checkout creates/updates the
subscription row; verified webhooks (`Stripe-Signature` over the raw body) move
it between trialing/active/past_due/canceled. Webhooks are idempotent via
`billing_events` with a unique `(provider, event_id)` — duplicate deliveries
are acknowledged but never re-applied. Downgrades beyond the target plan's
limits are blocked with `409`; upgrades always pass.

## Database

28 tables; the schema is owned by Flyway
(`backend/src/main/resources/db/migration`, V1–V5):

- Global: `plans`, `users`
- Tenant-scoped (all carry `workspace_id`): `workspaces`, `memberships`,
  `invites`, `verticals`, `rep_statuses`, `experience_levels`, `reps`,
  `clients`, `offers`, `placements`, `placement_requests`, `subscriptions`,
  `billing_events`, `workspace_discord`, `audit_log`,
  `skill_tags`, `rep_skills`, `rep_languages`, `rep_preferred_verticals`,
  `rep_photos`, `offer_required_skills` (V4),
  `metric_types`, `activity_entries`, `payouts`, `commission_rules`,
  `ledger_entries` (V5)
- Derived state is never stored: a rep is *Placed* when they have an active
  placement; an offer is *Filled* when active placements ≥ seats, *Closed*
  when its stored status is closed, otherwise *Open* (computed at query time).
- Workspaces are soft-deleted (`status = deleted`); a purge job
  (`WorkspacePurgeJob`) removes children in dependency order.
- New workspaces are seeded (in Java — Flyway cannot run `DELIMITER` stored
  procedures) with verticals *Sales / Advertising / Partnerships*, statuses
  *Bench / Training / Inactive*, levels *Junior / Mid / Senior*, plus a
  trialing subscription on the free plan.

## Tests

| Suite | What it proves |
| --- | --- |
| `AuthWorkspaceTest` | register/login/JWT, workspace creation seeds defaults + trialing subscription, slug rules, header requirements |
| `FilterWiringTest` | the Hibernate filter is inherited by every tenant entity and actually restricts queries |
| `TenantIsolationTest` | workspace A cannot read/update/delete anything in workspace B via any endpoint, even with guessed ids |
| `PlacementRulesTest` | closed/full offer rejected, second active placement rejected (service **and** database), concurrent last-seat race yields exactly one success, audit rows |
| `RoleMatrixTest` | every workspace-scoped endpoint exercised as all four roles |
| `Phase3InvitesPortalTest` | invite lifecycle (SHA-256 token hashes, revoke, expiry), CSV import preview/commit, rep portal scoping |
| `Phase4BillingTest` | duplicate webhook is idempotent, bad signature rejected, over-limit downgrade blocked, owner-only actions |
| `Phase5DiscordReportsTest` | Discord login links/creates accounts, role sync never grants or revokes owner, failing notification does not fail the placement, reports/branding/discord-settings role matrix and tenant scoping |
| `Phase6RosterIntelligenceTest` | bench-days clock (ended placement → joined date → creation, null while placed), CSV export columns/escaping/filters/roles and round-trip through import preview, audit feed paging newest-first with actor names, placed-rep delete guard |
| `Phase6SkillsProfilesTest` | skills/languages/availability/verticals round-trip on rep profiles, offer requirements, photo type + size validation and tenant-scoped bytes, roster skill/language/availability filters, skills lookup role matrix |
| `MatchScorerTest` | scoring weights, per-factor "why" strings, unset requirements score full, tier/edge cases, score clamped 0–100 |
| `CommissionMathTest` | percent (basis points), flat and tiered math incl. band boundaries, open-ended last band, remainder splitting — all integer minor units |
| `Phase7PerformanceTest` | every Phase 7 surface answers 402 on free and works after upgrade; reps log/edit only their own rows (7-day window); append-only ledger with reversing corrections, paid rows immutable; commission wiring per rule type; payouts batch one rep + one currency with CSV export; leaderboard periods + name masking; rep earnings isolation and cross-tenant scoping |
| frontend `src/test/` | roster/offer pages against the mocked API, billing upgrade/plan flows, Discord login + callback, reports rendering, branding/discord settings forms, bench-aging pills, CSV export download, activity feed paging, Phase 6 filters/profile form/suggested-reps panel, Phase 7 PRO gating, role tabs, minor-unit money conversion, payout batching, metric management |

## Configuration

All configuration comes from environment variables (see `.env.example`):
`DB_URL/DB_USER/DB_PASSWORD`, `JWT_SECRET` (≥32 chars), `JWT_TTL_MINUTES`,
`CORS_ALLOWED_ORIGINS`, `SERVER_PORT`, `APP_BASE_URL`,
`BILLING_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (+ Razorpay
placeholders, unimplemented), `DISCORD_CLIENT_ID/SECRET/REDIRECT_URI/BOT_TOKEN`,
and test-only `ROSTER_TEST_DB_*`.

## Assumptions

- Registration creates a user only; creating a workspace is a separate
  authenticated call that makes the caller the owner (seeds defaults +
  trialing free subscription).
- The `X-Workspace` header carries the workspace **id or slug**; subdomain
  resolution is also implemented (`acme.example.com`) with `roster.test`-style
  base domains configured via the Host header.
- Invite links are copyable (no email provider yet); acceptance sets the
  password on the invited email.
- Bench time in reports = gap from an ended placement to the rep's next
  placement (currently-benching reps are measured to now, from their last
  ended placement or joined date); roster cards show the same clock as a
  `Nd bench` pill that turns red past two weeks.
- Discord role sync upgrades only to rep/manager/admin and only when the
  workspace has a guild connection; owner is out of scope by design.
- Razorpay is a stub: selecting `BILLING_PROVIDER=razorpay` answers 503 until
  implemented.
