# Coeso Offers Board (standalone)

A private offers board for Coeso: a login gate, a board of setter and closer
offers that members can read, and an admin dashboard where the owner posts
offers and hands out logins.

This is a **separate project** from the original offers board — its own
`package.json`, its own database, its own deployment at its own URL. coeso.biz
links to it as a menu tab.

## Access model

- **No sign-up.** There is no registration form anywhere. The login page tells
  visitors to contact Coeso's Owner on Discord (`a1rymn`) for access, and tells
  offer owners to do the same if they want their offers posted.
- **The owner is the admin.** The first admin account is seeded from
  `ADMIN_USERNAME` / `ADMIN_PASSWORD` on the first request, then stored hashed
  in the database.
- **Members read and apply.** The admin creates an account (`/admin` →
  Accounts) and gets a one-time password to send to that person. Members can
  open the board and apply to a single offer from its page; they cannot create
  or edit offers, or see other members' applications.
- **Nothing bypasses the gate.** `/offers` and `/offers/[id]` redirect to
  `/login` without a valid session, every read API requires a session, and
  every write API requires an admin. Disabling or deleting an account ends its
  access on the next request.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript, built for Cloudflare
  Workers with [OpenNext](https://opennext.js.org/cloudflare)
- Tailwind CSS 4
- SQLite on **Cloudflare D1**, bound as `DB` (one database per site
  environment). `next dev` uses the same binding through
  `initOpenNextCloudflareForDev`, so local and deployed behaviour match
- Sessions: HMAC-signed, `httpOnly`, `SameSite=Lax` cookie; passwords hashed
  with Web Crypto PBKDF2-SHA256 at 100,000 iterations (the Workers ceiling)

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SECRET
npm run dev                  # http://localhost:3000/login
```

`next dev` runs the app on the local D1 database from
`freebuff.wrangler.jsonc`; state lives under `.wrangler/`. The first request
creates the schema and the admin account. Set `SEED_DEMO_DATA=false` to start
with an empty board.

To exercise the exact Worker build (workerd + D1) before deploying:

```bash
npm run build
npx wrangler dev --config freebuff.wrangler.jsonc --persist-to /tmp/board-state
```

Sign in at `/login` with the admin credentials, then create member accounts
and post offers from `/admin`.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | yes | Username for the seeded owner account (default `admin`) |
| `ADMIN_PASSWORD` | yes | Password for the seeded owner account |
| `ADMIN_SECRET` | yes | Signing key for session cookies |
| `SEED_DEMO_DATA` | no | `false` disables the demo seed |

`ADMIN_PASSWORD` only seeds the account when no admin exists. Later changes to
the environment do **not** reset a live password — use **Reset password** in
the dashboard, which issues a new one-time password.

The database is the platform-provided `DB` binding, so there is no connection
string to configure. Provision it once per site environment.

## Routes

| Route | Access |
| --- | --- |
| `/login` | public — sign in, owner contact notice |
| `/offers`, `/offers/[id]` | any signed-in account |
| `/admin` | admin — offers, accounts, applications |
| `/admin/offers/[id]` | admin — edit an offer |

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/auth/login` `{username,password}` | public |
| `POST` | `/api/auth/logout` | public |
| `GET` | `/api/offers` (`?all=1` for admin) | signed in |
| `POST` | `/api/offers` | admin |
| `PATCH` | `/api/offers/[id]` `{status}` or full offer | admin |
| `DELETE` | `/api/offers/[id]` | admin |
| `GET` | `/api/accounts` | admin |
| `POST` | `/api/accounts` `{username,role}` | admin |
| `PATCH` | `/api/accounts/[id]` `{action}` | admin |
| `DELETE` | `/api/accounts/[id]` | admin |
| `POST` | `/api/offers/[id]/apply` | signed in |
| `GET` | `/api/applications` | admin |
| `PATCH` | `/api/applications/[id]` `{status}` | admin |

`POST /api/accounts` and `PATCH … {action:"reset_password"}` return the new
plaintext password once, for the admin to forward. It is never stored in clear.

## Live deployment

Hosted on **Freebuff Sites** (Cloudflare Workers + D1):

| Environment | URL |
| --- | --- |
| Production | https://coeso-offers-board-gzjzfv.freebuff.site |
| Preview | https://coeso-offers-board-gzjzfv-preview.freebuff.site |

Both are published. Production runs with `SEED_DEMO_DATA=false`, so the board
starts empty; preview keeps the demo offers for review.

### Redeploying

```bash
# 1. build the Worker bundle and manifest (writes freebuff-sites-build/)
npx opennextjs-cloudflare build \
  --config freebuff.wrangler.jsonc \
  --openNextConfigPath freebuff.open-next.config.ts

# 2. upload offers-board/freebuff-sites-build/manifest.json with the Sites
#    deployer, targeting preview first, then production
```

Each site environment has one D1 database bound as `DB`; deploys attach it
automatically. Secrets are set in the Sites panel (or with the Sites secret
tool) and survive redeploys: `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
`ADMIN_SECRET`, and optionally `SEED_DEMO_DATA`.

The first request after deployment creates the schema and the owner account
from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Add it to the coeso.biz menu

The board is its own deployment, so the menu entry is a plain link and no
rewrite is needed:

```html
<a href="https://<offers-board-url>/offers">Offers Board</a>
```

Concretely:

```html
<a href="https://coeso-offers-board-gzjzfv.freebuff.site/offers">Offers Board</a>
```

Because `/offers` is gated, visitors land on `/login` first. If you would
rather serve it on the main domain, add a rewrite in the coeso.biz project:

```json
{
  "rewrites": [
    { "source": "/offers", "destination": "https://<offers-board-url>/offers" },
    { "source": "/offers/:path*", "destination": "https://<offers-board-url>/offers/:path*" }
  ]
}
```

(The coeso.biz codebase is not part of this repository, so that menu entry has
to be changed in that project.)

## Data model

- `accounts` — username (unique, case-insensitive), scrypt password hash, role
  (`admin` / `viewer`), active flag, created_at, last_login_at
- `offers` — title, company, role type (setter/closer/both), commission, pay
  type, description, requirements, status (open/closed), featured, created_at
- `applications` — offer, member account (id + username, name cleared if the
  account is deleted), email, Discord, experience, hours per week, message,
  status (`new` / `reviewed`). The admin reads and reviews them on `/admin`;
  the applicant identity is taken from the session, never the request body.

Schema is created idempotently on first request (`CREATE TABLE IF NOT EXISTS`).
