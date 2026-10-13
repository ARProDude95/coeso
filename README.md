# Roster

A multi-tenant SaaS for agencies and communities to manage a roster of sales
reps, post client offers, and place reps on those offers. Each workspace = one
agency/community; every decision in the schema and the code assumes many
isolated tenants. The first tenant is Cooeso (workspace #1); the product is
sold to other communities afterwards.

**Status:** all planned phases are implemented — backend foundation (1),
frontend (2), invites / CSV import / rep portal (3), billing (4), and Discord
integration + reports + white-label (5). See "What was built per phase" below.

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
    workspace/      workspace lifecycle, membership, default seeding
    audit/          audit_log writer
  src/main/resources/db/migration/   Flyway migrations (V1 schema, V2 plans,
                                     V3 discord login)
  src/test/                         integration test suites
frontend/           React + TypeScript + Vite app
  src/pages/        login/register, workspace picker, roster, offers,
                    reports, settings (lookups, billing, branding, discord)
  src/test/         vitest suites
docker-compose.yml  MySQL 8 for local development
.env.example        all environment variables, documented
```

## Quick start

Prerequisites: JDK 21, Maven, Node 20+, Docker (or a local MySQL 8).

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
mvn test                            # full suite (55 tests)
mvn test -Dtest=Phase5DiscordReportsTest   # one class

# frontend
cd frontend
npm test                            # vitest (16 tests)
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
| reps | `GET /api/reps` (filters `q`, `verticalId`, `statusId`, `experienceId`, `placed`, `page`, `size`), `POST`, `PUT /{id}`, `DELETE /{id}` (soft) | manager+ |
| rep csv | `POST /api/reps/import/preview`, `POST /api/reps/import` | manager+ |
| rep portal | `GET /api/me/rep`, `GET /api/me/placement`, `GET /api/me/open-offers` | any member |
| clients | `GET/POST /api/clients`, `PUT/DELETE /{id}` | manager+ |
| offers | `GET /api/offers` (filters `q`, `verticalId`, `effectiveStatus`), `POST`, `PUT /{id}`, `POST /{id}/close` | manager+ |
| placements | `POST /api/placements`, `POST /api/placements/{id}/end`, `GET ?offerId= / ?repId=` | manager+ |
| placement requests | `POST /api/placement-requests`, `GET ?status=`, `POST /{id}/approve`, `POST /{id}/decline` | create: any member (rep: own profile only); decisions: manager+ |
| lookups | `GET/POST /api/verticals`, `/statuses`, `/experience-levels`, `PUT/DELETE /{id}` | read: any member; write: admin+ |
| stats | `GET /api/stats` | manager+ |
| reports | `GET /api/reports` (placement rate, avg bench days, placements per offer, per-vertical breakdown) | manager+ |
| discord settings | `GET/PUT /api/discord/settings` (guild id, notification channel, role map) | admin+ |
| billing | `GET /api/billing/plans`, `GET /api/billing/subscription`, `POST /api/billing/checkout` (owner), `POST /api/billing/plan` (owner), `POST /api/billing/webhooks/stripe` (public, signature-verified) | as noted |

Plan limits (`max_reps`, `max_members`) are enforced in the service layer and
answer `402` with `code: PLAN_LIMIT_EXCEEDED` and
`details: {resource, current, limit}`. Seeded plans: free (10 reps / 3
members), starter (50/10), pro (250/50), unlimited (no limits).

Error envelope for every failure:

```json
{ "status": 409, "code": "CONFLICT", "message": "Offer is full (1/1 seats filled)", "details": null }
```

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

18 tables; the schema is owned by Flyway
(`backend/src/main/resources/db/migration`):

- Global: `plans`, `users`
- Tenant-scoped (all carry `workspace_id`): `workspaces`, `memberships`,
  `invites`, `verticals`, `rep_statuses`, `experience_levels`, `reps`,
  `clients`, `offers`, `placements`, `placement_requests`, `subscriptions`,
  `billing_events`, `workspace_discord`, `audit_log`
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
| frontend `src/test/` | roster/offer pages against the mocked API, billing upgrade/plan flows, Discord login + callback, reports rendering, branding/discord settings forms |

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
  ended placement or joined date).
- Discord role sync upgrades only to rep/manager/admin and only when the
  workspace has a guild connection; owner is out of scope by design.
- Razorpay is a stub: selecting `BILLING_PROVIDER=razorpay` answers 503 until
  implemented.
