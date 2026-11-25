# Coeso Offers Board (standalone)

A self-contained offers board for Coeso sales reps: a public board of setter and
closer offers, a no-account application form, and a password-gated admin room to
post and manage offers.

This is a **separate project** from the original offers board — its own
`package.json`, its own database, its own deployment. It owns the `/offers/*`
path so it can be mounted at `coeso.biz/offers` as a menu tab.

## Stack

- Next.js 16 (App Router, Node runtime) + React 19 + TypeScript
- Tailwind CSS 4
- SQLite: Node's built-in `node:sqlite` locally, [Turso](https://turso.tech)
  (libSQL over HTTP) in production — no native modules, works on serverless
- No user accounts, no payments. Applications carry contact details directly.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in ADMIN_PASSWORD + ADMIN_SECRET
npm run dev                  # http://localhost:3000/offers
```

First request creates `.data/offers.db` and seeds six demo offers. Set
`SEED_DEMO_DATA=false` to start empty.

Admin: <http://localhost:3000/offers/admin> — enter `ADMIN_PASSWORD`.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes (admin) | Password for `/offers/admin` |
| `ADMIN_SECRET` | yes (admin) | Signing key for the admin cookie |
| `TURSO_DATABASE_URL` | production | `libsql://…` from Turso |
| `TURSO_AUTH_TOKEN` | production | Turso token |
| `SEED_DEMO_DATA` | no | `false` disables demo seed |
| `LOCAL_DB_PATH` | no | Override local SQLite file path |

Without `TURSO_*` the app uses a SQLite file — perfect for local dev and any
Node host with a writable disk. On Vercel (read-only filesystem) Turso is
required.

## Deploy to Vercel (free Hobby plan)

1. **Create a Turso database** (free tier: 5 GB, 500M row reads/month):
   ```bash
   turso db create coeso-offers
   turso db show coeso-offers --url        # libsql://…
   turso db tokens create coeso-offers     # auth token
   ```
2. **Deploy** from this folder:
   ```bash
   npx vercel --prod
   ```
   (or push to GitHub and import the repo with **Root Directory = `offers-board`**)
3. **Set env vars** in Vercel → Project → Settings → Environment Variables
   (Production + Preview):
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD`, `ADMIN_SECRET`.
4. Open the deployment URL — the first request creates the schema and seeds the
   board.

## Mount it on coeso.biz as a menu tab

The app owns `/offers`, `/offers/[id]` and `/offers/admin`, so the mapping is
1:1. Pick one:

**A. Same domain, path mount (recommended — the menu tab is just `/offers`).**
On the coeso.biz project (Next.js on Vercel), add to `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/offers", "destination": "https://coeso-offers.vercel.app/offers" },
    { "source": "/offers/:path*", "destination": "https://coeso-offers.vercel.app/offers/:path*" }
  ]
}
```

Then add the nav item wherever the site renders its menu:

```html
<a href="/offers">Offers Board</a>
```

**B. Subdomain.** In Vercel → the offers project → Domains, add
`offers.coeso.biz` and point DNS (`CNAME` → `cname.vercel-dns.com`). The menu
tab links to `https://offers.coeso.biz`.

Either way the site's existing "Offers Board" product link should change from
the Freebuff URL to `/offers` (or the subdomain).

## API

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/offers` (`?all=1` for admin) | public |
| `POST` | `/api/offers` | admin |
| `PATCH` | `/api/offers/[id]` `{status}` | admin |
| `POST` | `/api/applications` | public |
| `GET` | `/api/applications` | admin |
| `POST` | `/api/admin/login` `{password}` | public |
| `POST` | `/api/admin/logout` | public |

## Data model

- `offers` — title, company, role type (setter/closer/both), commission, pay
  type, description, requirements, status (open/closed), featured, created_at
- `applications` — offer, name, email, Discord handle, experience, hours/week,
  message, status, created_at

Schema is created idempotently on first request (`CREATE TABLE IF NOT EXISTS`).
