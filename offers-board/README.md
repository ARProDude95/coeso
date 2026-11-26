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
- **Members are view-only.** The admin creates an account (`/admin` → Accounts)
  and gets a one-time password to send to that person. Members can open the
  board and an offer, and nothing else.
- **Nothing bypasses the gate.** `/offers` and `/offers/[id]` redirect to
  `/login` without a valid session, every read API requires a session, and
  every write API requires an admin. Disabling or deleting an account ends its
  access on the next request.

## Stack

- Next.js 16 (App Router, Node runtime) + React 19 + TypeScript
- Tailwind CSS 4
- SQLite: Node's built-in `node:sqlite` locally, [Turso](https://turso.tech)
  (libSQL over HTTP) in production — no native modules, works on serverless
- Sessions: HMAC-signed, `httpOnly`, `SameSite=Lax` cookie; passwords hashed
  with scrypt

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SECRET
npm run dev                  # http://localhost:3000/login
```

First request creates `.data/offers.db`, the schema, and the admin account.
Set `SEED_DEMO_DATA=false` to start with an empty board.

Sign in at `/login` with the admin credentials, then create member accounts
and post offers from `/admin`.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | yes | Username for the seeded owner account (default `admin`) |
| `ADMIN_PASSWORD` | yes | Password for the seeded owner account |
| `ADMIN_SECRET` | yes | Signing key for session cookies |
| `TURSO_DATABASE_URL` | production | `libsql://…` from Turso |
| `TURSO_AUTH_TOKEN` | production | Turso token |
| `SEED_DEMO_DATA` | no | `false` disables the demo seed |
| `LOCAL_DB_PATH` | no | Override the local SQLite file path |

`ADMIN_PASSWORD` only seeds the account when no admin exists. Later changes to
the environment do **not** reset a live password — use **Reset password** in
the dashboard, which issues a new one-time password.

Without `TURSO_*` the app uses a SQLite file, which is fine locally and on any
Node host with a writable disk. On Vercel (read-only filesystem) Turso is
required.

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
| `GET` | `/api/applications` | admin |

`POST /api/accounts` and `PATCH … {action:"reset_password"}` return the new
plaintext password once, for the admin to forward. It is never stored in clear.

## Deploy

1. **Create a Turso database** (free tier):
   ```bash
   turso db create coeso-offers
   turso db show coeso-offers --url
   turso db tokens create coeso-offers
   ```
2. **Deploy** this folder (`npx vercel --prod`, or import the repo with
   **Root Directory = `offers-board`**).
3. **Set env vars** in Production + Preview: `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SECRET`.
4. Open the deployment URL — the first request creates the schema and the
   owner account.

## Add it to the coeso.biz menu

The board is its own deployment, so the menu entry is a plain link and no
rewrite is needed:

```html
<a href="https://<offers-board-url>/offers">Offers Board</a>
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
- `applications` — legacy board applications, readable by the admin

Schema is created idempotently on first request (`CREATE TABLE IF NOT EXISTS`).
