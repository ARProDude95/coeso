# Coeso Offers Board

A private job board for Coeso sales reps. Reps create an account, browse live
offers and track their applications. Admins publish offers, review applicants
and leave private notes.

Accounts are email + password, owned by the app — no third-party login
dependency. Discord is the paid-plan extra: channel announcements and
role-gated offers, configured from /admin/settings, with sign-in left alone.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS v4 · Cloudflare D1

---

## Features

| Area | What's there |
| --- | --- |
| Accounts | Email + password, PBKDF2-SHA256 hashes, signed JWT session cookie |
| Gating | Every page and API route checks the account server-side; admins via `is_admin` |
| Offers | Filters (role type, status, search), featured pinning, `expires_at` auto-close |
| Applications | Experience level, availability, optional past results, short message; one per offer |
| Review | Accept / reject with a private admin-only note; dashboard counts |
| Discord | Paid: channel webhook announcement on publish, plus offers gated to an access role |
| Plans | `free` vs `paid` flag on `/admin/settings`; the Discord features check it on every use |
| Roles | Admin-assigned slugs on `/admin/members`; gated offers stay invisible to members without the role |
| Pricing | Public `/pricing` page with the free vs paid comparison, driven by a Whop hosted-checkout link |

---

## Getting started

```bash
npm install
cp .env.example .env      # then edit SESSION_SECRET
npm run dev
```

Open <http://localhost:3000>. The first account you create becomes the admin;
every later account is a member.

`npm run dev` picks up the local D1 database through the generated Wrangler
config, so there is no separate database to install and no migration to run —
the schema is created on the first request. To skip the sample offers, set
`SEED_DEMO_DATA=false` before the first run.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with the local D1 binding |
| `npm run build` | Production build |
| `npm run typecheck` | Regenerate route types, then `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run preview` | Build the Cloudflare worker and run it locally in workerd |

> **Windows note:** this project builds with `--webpack` because some machines'
> Application Control policies block the Turbopack native binary. Remove the
> flag from `package.json` where Turbopack runs normally.

---

## Environment

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs the session cookie — required, 48 random bytes of hex |
| `NEXT_PUBLIC_APP_URL` | Public origin, no trailing slash (used in offer links) |
| `DISCORD_WEBHOOK_URL` | Fallback webhook — `/admin/settings` takes precedence when set |
| `SEED_DEMO_DATA` | Set to `false` to deploy an empty board |
| `WHOP_API_KEY` | Server-side Whop API key (checkout creation) |
| `WHOP_WEBHOOK_SECRET` | `ws_…` signing secret for `/api/webhooks/whop` |
| `WHOP_ACCOUNT_ID` | Optional `biz_…` account id sent with checkout creation |
| `WHOP_API_BASE_URL` | REST base; use the sandbox URL in development |
| `WHOP_PLAN_ID_*` | One Whop plan id per price (see `.env.example`) |
| `WHOP_MANAGE_URL` | Where “Manage or cancel on Whop” points |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Paid plan: announcements + role gating

Everything Discord sits behind one flag on the singleton settings row, so the
feature can be sold without touching sign-in.

**Selling it:** this board-level flag is still flipped by hand on
`/admin/settings`; the legacy *Whop checkout* link there remains as a manual
fallback. Per-member **Pro/Elite** plans are sold through real Whop
subscriptions — see **Whop setup** below — and access for those comes from the
subscription record, not from this flag.

1. **Switch the board to paid** — `/admin/settings` → *Switch to paid plan*.
   The free plan keeps the board, offers and applications exactly as they are.
2. **Paste the channel webhook** — Edit Channel → Integrations → Webhooks →
   New Webhook → Copy URL. Saves here (it must be `https://`, and the stored
   value wins over `DISCORD_WEBHOOK_URL`); an empty value disables posting.
   Every offer published as `open` then posts an embed with pay, commission and
   expiry. Downgrading stops posting immediately and keeps the URL.
3. **Gate an offer** — the offer form grows a *Gate to a role* field while the
   board is paid. Set it and members without that role cannot see the offer
   anywhere: it is filtered out of the list, its detail page renders the
   “not found” view, and the apply endpoint returns `404`.
4. **Assign roles** — `/admin/members`, per member: a slug such as
   `closer-vip`. Stored lowercase, shown as chips, and offered as autocomplete
   on the offer form.

Clearing a gate is always allowed, even on the free plan, so a downgraded
board can still open its offers back up. Adding a gate while free returns
`403` with `code: "upgrade_required"`.

---

## Whop setup (subscriptions)

All money is collected through Whop. This app never handles cards or UPI: it
creates hosted checkouts with the official `@whop/sdk` (REST v1, API version
pinned in `src/lib/pricing.ts`) and verifies Whop's webhooks. Access is always
read from the `subscriptions` table, never from the browser.

### 1. Create the business and the six plans

1. Create a Whop business and connect payouts in the Whop dashboard.
2. Under **Products**, create the plans in this table. Prices live in exactly
   one place in code — `PRICING_PLANS` in `src/lib/pricing.ts` — so the
   dashboard amounts must match it.

| Plan key | Dashboard product/plan | Amount | Env var |
| --- | --- | --- | --- |
| `pro_monthly` | Pro monthly | $12/mo | `WHOP_PLAN_ID_PRO_MONTHLY` |
| `pro_annual` | Pro annual | $99/yr | `WHOP_PLAN_ID_PRO_ANNUAL` |
| `elite_monthly` | Elite monthly | $29/mo | `WHOP_PLAN_ID_ELITE_MONTHLY` |
| `elite_annual` | Elite annual | $249/yr | `WHOP_PLAN_ID_ELITE_ANNUAL` |
| `pro_founding` | Pro founding (monthly) | $9/mo | `WHOP_PLAN_ID_PRO_FOUNDING` |
| `elite_founding` | Elite founding (monthly) | $19/mo | `WHOP_PLAN_ID_ELITE_FOUNDING` |

Founding and standard prices are **separate Whop plans on purpose**: changing
a standard price later never re-points an existing founding subscriber at the
new price. Indian buyers are charged the explicit INR amounts in the same
config (₹499/₹1,299 monthly, ₹4,999/₹12,999 annual, ₹399/₹899 founding), not
a conversion at checkout.

### 2. API key and environment

1. **Business settings → API keys** → create a server-side key. Put it in
   `WHOP_API_KEY` (server only; never `NEXT_PUBLIC_*`).
2. Copy each plan's `plan_…` id into the matching `WHOP_PLAN_ID_*` variable.
3. For development, point `WHOP_API_BASE_URL` at
   `https://sandbox-api.whop.com/api/v1` and repeat steps 1–2 in the sandbox
dashboard. Sandbox and production have separate plans, keys and data.
4. Copy `.env.example` → `.env` and fill `SESSION_SECRET` and the Whop vars.

A plan whose env var is missing shows “Checkout not configured” on `/pricing`;
the rest of the board keeps working.

### 3. Webhook

1. **Business settings → Webhooks → New endpoint**, URL:
   `https://<your-domain>/api/webhooks/whop`.
2. Subscribe to: `payment.succeeded`, `payment.failed`,
   `membership.activated`, `membership.deactivated`,
   `membership.cancel_at_period_end_changed`.
3. Copy the endpoint's `ws_…` signing secret into `WHOP_WEBHOOK_SECRET`.
   The route verifies it over the raw body with the SDK (`unwrapWebhook`) and
   answers `400` for anything that does not verify — no unsigned event is ever
   processed.
4. The route is idempotent: every event id is claimed in `whop_events`, so a
   Whop retry is a no-op. A processing failure releases the claim and returns
   `500`, so the retry can succeed.

**Local testing:** Whop cannot reach `localhost`, so expose the dev server
with a tunnel (`cloudflared tunnel --url http://localhost:3000` or ngrok) and
register `https://<tunnel>/api/webhooks/whop` on the **sandbox** business.
Run the app with `WHOP_API_BASE_URL=https://sandbox-api.whop.com/api/v1` and
the sandbox plan ids, then complete a sandbox checkout from `/pricing`.

### 4. What the webhook does

`payment.succeeded` / `membership.activated` → the subscription is
`active` with the plan's tier, membership id and period end.
`membership.deactivated` → `canceled` (access drops immediately, because
`effectiveTier` only unlocks active/past-due/granted rows).
`membership.cancel_at_period_end_changed` → keeps access until the period ends
and flags the scheduled cancellation. `payment.failed` → `past_due` (dunning,
not an instant downgrade).

### 5. Founding slots

`FOUNDING_SLOTS = 20` in `src/lib/pricing.ts`. A founding slot is claimed by a
**single conditional SQL UPDATE** the first time a founding payment (or
activation) confirms, guarded by a unique index on `founding_slot` — two
simultaneous checkouts can never both take slot 20. The loser is placed on the
standard plan and a `founding_overflow` flag appears under **Billing → Needs
manual action** for an admin to fix on Whop. Cancelling does not free a slot
(the count never goes back up), and `/pricing` shows “Founding price: X of 20
spots left” from the live database count.

### 6. Billing page

`/billing` shows the current plan and status, the period end, a founding slot
badge, and a link to manage or cancel on Whop. It also hosts the admin-only
manual tier grant (which writes a `granted` subscription row), an admin
“Grant founding slot” action for comps, and the list of open billing flags.
Admins can also still change a tier from `/admin/members`.

### 7. Sandbox smoke test

With the app running and the sandbox variables loaded:

```bash
# Full run: real sandbox checkout + signed webhook + billing check
npm run smoke:whop -- --create-user

# A specific member and plan
npm run smoke:whop -- --user-id <uuid> --plan elite_monthly

# No Whop API call: webhook signature, replay and billing only
npm run smoke:whop -- --skip-checkout --create-user
```

The script:

1. creates a throwaway account (or uses `--user-id`) and keeps its session
   cookie for the billing check;
2. creates a real hosted checkout through the sandbox SDK and prints its URL;
3. posts a correctly signed `payment.succeeded` to
   `/api/webhooks/whop`, expecting `200 {ok:true}`;
4. replays the identical delivery, expecting `200 {duplicate:true}`;
5. opens `/billing` as that member and checks the plan label and `Active`
   status rendered.

`WHOP_WEBHOOK_SECRET` must match the running app, and the chosen plan's
`WHOP_PLAN_ID_*` must be set (the replayed event uses it so the handler can map
the tier). `WHOP_API_KEY` is only needed without `--skip-checkout`.

Safety: the script defaults to `https://sandbox-api.whop.com/api/v1`, never
prints keys, and refuses to create a checkout against a non-sandbox base URL
without `--allow-production`. It writes a real membership row, so point it at a
disposable sandbox database, not production.

### 8. CI smoke job

`.github/workflows/whop-smoke.yml` runs the smoke test in GitHub Actions. By
default it starts **its own disposable instance** on the runner with
`wrangler.ci.jsonc` and a fresh local D1 database — no hosted deployment is
created, and nothing survives the job.

It runs:

- manually (`Actions → Whop sandbox smoke → Run workflow`), optionally with an
  `app_url` pointing at an already-running sandbox deployment;
- every Monday;
- on pushes to `main`/`master` that touch billing, webhook, pricing, the
  database schema or the smoke script.

Add these **repository secrets** (Settings → Secrets and variables → Actions),
using sandbox values:

| Secret | Required | Purpose |
| --- | --- | --- |
| `WHOP_WEBHOOK_SECRET` | yes | Signs the replayed event; must match the app instance |
| `WHOP_PLAN_ID_PRO_MONTHLY` | yes (default plan) | Maps the replayed event to Pro; required for any run using the default plan |
| `WHOP_API_KEY` | for checkout | Creates the real sandbox checkout |
| `WHOP_ACCOUNT_ID` | optional | Sent with checkout creation when set; not needed for the webhook-only path |
| `WHOP_PLAN_ID_PRO_ANNUAL` | when selected | Required if dispatching with `plan: pro_annual` |
| `WHOP_PLAN_ID_ELITE_MONTHLY` | when selected | Required if dispatching with `plan: elite_monthly` |
| `WHOP_PLAN_ID_ELITE_ANNUAL` | when selected | Required if dispatching with `plan: elite_annual` |
| `WHOP_PLAN_ID_PRO_FOUNDING` | when selected | Required if dispatching with `plan: pro_founding` |
| `WHOP_PLAN_ID_ELITE_FOUNDING` | when selected | Required if dispatching with `plan: elite_founding` |

Behaviour:

- The selected plan's `WHOP_PLAN_ID_*` and `WHOP_WEBHOOK_SECRET` are always
  required, because the replayed event has to map back to a tier.
- With `WHOP_API_KEY` as well, it creates a real sandbox checkout, then
  replays the signed webhook and checks billing.
- Without `WHOP_API_KEY` it prints a warning and runs the webhook-only path
  (`--skip-checkout`), so the signature, idempotency and billing checks still
  run.
- A **manual** run fails fast when a required secret is missing; scheduled
  and push runs skip with a warning rather than failing every week.
- On failure it uploads `whop-smoke-app.log` as the `whop-smoke-app-log`
  artifact.

To target an existing deployment, pass `app_url` when dispatching. That
instance must use the same `WHOP_WEBHOOK_SECRET` and sandbox plan ids, and the
job will create a throwaway account on it.

---

## Accounts and admin

- **Sign up** on `/login` with a name, email and password (8+ characters).
- The **first account** on a fresh board is the admin. Everyone after it is a
  member.
- An admin sees an **Admin** link in the header: publish, edit, pause, close and
  feature offers, review applicants, accept/reject, and leave a private note
  that the applicant never sees.
- Admins are resolved from the `users.is_admin` column on every request, so
  changes apply immediately rather than at the next sign-in.

## How access is enforced

- **Pages** — `requireMember()` / `requireAdmin()` run before any data is read
  and redirect to `/login` or `/offers`.
- **API routes** — every handler runs inside `runApi()` and starts with
  `requireMemberApi()` or `requireAdminApi()`, which throw 401/403.
- **`src/proxy.ts`** — an optimistic check that bounces signed-out visitors off
  protected pages without rendering a shell. It only verifies the cookie
  signature; it is not the authorization layer.
- **Validation** — Zod schemas in `src/lib/validation.ts` run server-side on
  every payload; field errors come back as `400` with `fieldErrors`.
- **Data** — applications are scoped to `user.id`, the one-application-per-offer
  rule is a database unique index, and `admin_note` is never in the applicant's
  column list. Passwords are stored as PBKDF2-SHA256 (100k iterations, per-user
  salt) and compared in constant time. 100k is the Cloudflare Workers ceiling for
  Web Crypto PBKDF2 — the count is embedded in each hash, so it can be raised
  without breaking existing passwords if the app ever runs somewhere uncapped.
- **Role gating** — an offer with `required_role` is filtered out of the member
  list in SQL, and both the detail page and the apply endpoint answer `404`
  rather than `403`, so the response doesn't reveal that the offer exists.
  Admins bypass the check; enforcement does not depend on the current plan.

## Database

Cloudflare D1 (SQLite). [`db/schema.sql`](db/schema.sql) documents the tables;
the app applies the same DDL itself on first request, so there is no migration
command to remember. Timestamps are ISO-8601 strings and booleans are `0`/`1`.
The paid-plan flag, webhook and Whop checkout link live in the single
`settings` row; access roles live in `user_roles`.

## Deploying

The project ships as a Cloudflare Worker through the OpenNext adapter:

```bash
npm run preview   # build + run the real worker locally
```

Publishing is done from the Sites panel, which builds the worker, attaches the
`DB` binding, and serves it. Set `SESSION_SECRET` as a secret in the deployed
environment before the first published request.

## Project structure

```
db/schema.sql              D1 schema (reference; applied automatically)
src/proxy.ts               Optimistic signed-out redirect
src/lib/                   env, d1, session, auth guards, password, DAL, validation, webhook
src/app/                   offers, pricing, applications, admin, login, api
src/components/            header, filters, cards, forms, review controls, auth form
```

## Notes & assumptions

- **Accounts are self-service.** Anyone who reaches the sign-in page can create
  a member account; there is no invite code. Add one before opening the board to
  a wider audience.
- **Roles are assigned by hand for now.** `user_roles` mirrors Discord's
  guild-role shape so a Discord API sync can fill it in later without a schema
  change — Discord sign-in stays out of the product either way.
- **The first account becomes admin.** On a fresh deployment, create your own
  account first.
- **No password reset flow.** There is no email sender wired up, so a forgotten
  password currently needs a database change.
- **Webhook fires on creation only.** A new offer created as `open` announces to
  Discord; re-opening a paused offer does not re-announce. Announcements never
  fail the offer — a webhook outage is logged and ignored.
- **Auto-close is opportunistic.** Expired offers are closed on every offer or
  admin read rather than by a scheduler — no cron needed, and the close persists.
- **`/` redirects to `/offers`**; there is no public landing page.
- **Filters default to `status=open`.** Choosing "Open" in the dropdown resets to
  that default.
- **Paused offers stay visible** to members who pick them in the status filter,
  but are excluded from the default view.
