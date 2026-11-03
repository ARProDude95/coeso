# Roster — deployment & 24/7 operations

Roster ships as a single Cloudflare Worker that serves both the SPA and the
`/api/*` backend, backed by a managed D1 (SQLite) database. There is no server
to patch, no container to restart, and nothing to keep warm.

**Live now:** <https://site-c3c99a72dd9e4825b685d4cde46b89ba.freebuff.page>

| Piece | Runtime |
| --- | --- |
| Frontend | Static Vite build served by the Worker (`env.ASSETS`) |
| API | `worker/src/index.js` → `routes.js` + `routes-core.js` |
| Database | D1 binding `DB` (schema in `worker/schema.sql`, demo data in `worker/seed.sql`) |
| Auth | Stateless JWT signed with the `JWT_SECRET` secret |

---

## 1. How a deploy works

The deployable artifact is **only** `sites-deploy/`. Never publish the repository
root — it contains `frontend/node_modules`, the Maven backend and local secrets,
and it exceeds the 10 MiB upload limit.

```bash
# 1. bundle the Worker
frontend/node_modules/.bin/esbuild worker/src/index.js \
  --bundle --format=esm --platform=neutral --target=es2022 \
  --outfile=sites-deploy/worker.js

# 2. refresh static assets
cd frontend && npm run build && cd ..
rm -rf sites-deploy/dist && cp -r frontend/dist sites-deploy/dist
```

Then publish the package described by `sites-deploy/manifest.json`
(`entrypoint: worker.js`, `assetsDirectory: ./dist`, `spa: true`) through the
Sites deploy step. `sites-deploy/` is gitignored — it is build output.

A deploy replaces code and static assets. Bindings (`DB`) and secrets
(`JWT_SECRET`) survive, so **schema changes need their own migration step**:

```bash
cd worker
npx wrangler d1 execute <database-name> --remote --file=schema.sql
```

---

## 2. Staying up 24/7

### Recommended: keep it on Freebuff Sites (what is running today)

- $0, no credit card, no server to maintain.
- Hosted on Cloudflare's edge: no cold-start container, no OS patching, no
  process supervisor.
- Included per month: 100,000 requests, 10,000 requests/day, 100 MB D1 storage,
  100,000 D1 row writes, 5,000,000 ms CPU.
- Custom domain supported.

This is the right home for Roster while it is proving itself. Watch two quota
counters, both visible in the Sites panel:

| Counter | Limit | What to do at ~80% |
| --- | --- | --- |
| Monthly requests | 100,000 | Move to Workers Paid |
| D1 row writes | 100,000 / month | Move to Workers Paid |

A page load is roughly 4–8 requests (HTML, CSS, JS, a few `/api` calls), so
100k requests is on the order of 15–20k page views per month.

### When you outgrow it

| Option | Cost | Best for |
| --- | --- | --- |
| **Cloudflare Workers Paid** | ~$5/mo | Same architecture, 10M requests/mo, no code changes. **First upgrade step.** |
| **Hetzner CX23 + Docker** | ~€6/mo | Only if you need the Spring Boot backend (`backend/`) and MySQL for full feature parity. `docker-compose.prod.yml` + `Caddyfile` are already in the repo. |
| Fly.io | ~$2/mo, no free tier | Single small always-on VM, similar effort to Hetzner. |
| Railway | $5/mo hobby | Easiest managed Docker host if you prefer a dashboard over a shell. |

Moving from Sites to Workers Paid keeps the same Worker, D1 database and
secrets — it is a billing change plus re-pointing the DNS record, not a rewrite.

### Custom domain

1. Own a domain (any registrar).
2. Add the site's target hostname in the hosting panel and create the `CNAME`
   record it shows you.
3. Wait for the certificate to issue (usually under a minute on Cloudflare).
4. Set the app's public origin so links and CORS stay consistent.

Keep the `*.freebuff.page` URL as a fallback until the custom domain has served
traffic for a few days.

---

## 3. Secrets and configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `DB` | D1 binding | Managed; injected at deploy time. |
| `JWT_SECRET` | Secret | Set once. Rotating it signs every user out. |

Local development uses `worker/.dev.vars` and `worker/.jwt-secret`, both
gitignored. **Never** commit either, and never paste the secret value into a
chat, an issue or a screenshot.

Rotating `JWT_SECRET` deliberately:

```bash
# write the new value to a file that is gitignored, then upload from that path
# (do not echo it to a terminal or a log)
```

---

## 4. Backups

D1 has no automatic point-in-time restore on the free tier, so take your own
copy weekly — and always immediately before a schema change.

```bash
cd worker
npx wrangler d1 export <database-name> --remote --output=backup-$(date +%F).sql
```

Store the export somewhere off this machine (cloud drive, private repo, object
storage). It contains real user data: keep it private and delete old copies.

Restore:

```bash
npx wrangler d1 execute <database-name> --remote --file=backup-2026-11-03.sql
```

---

## 5. Monitoring

- **Sites panel** — request count, D1 rows read/written, storage, CPU. This is
  the first place to look when something feels slow or starts failing.
- **Worker logs** — stream them while debugging instead of guessing:
  `cd worker && npx wrangler tail`
- **Health probe** — `GET /api/auth/me` returns `401` when the API is healthy
  and unauthenticated. A `5xx`, a timeout, or an HTML response instead of JSON
  means the Worker is down or the bundle failed to build.
- **Uptime check** — point a free uptime monitor at the site root expecting
  `200`, and a second check at `/api/auth/me` expecting `401`. Alerting on the
  second one catches "page loads but the API is broken".

---

## 6. Continuous deployment

The release is two build commands plus an upload, so it fits comfortably in CI:

```yaml
# .github/workflows/deploy.yml (sketch)
on:
  push:
    branches: [master]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci --prefix frontend
      - run: npm test --prefix frontend        # 53 tests must pass
      - run: npm run build --prefix frontend
      - run: npx --prefix frontend esbuild worker/src/index.js --bundle --format=esm --platform=neutral --target=es2022 --outfile=sites-deploy/worker.js
      - run: rm -rf sites-deploy/dist && cp -r frontend/dist sites-deploy/dist
      # upload sites-deploy/ with the platform's deploy action
```

Gate the deploy on `npm test` — it takes about 12 seconds and covers every
page, the performance module and the community features.

---

## 7. Keeping Roster a separate platform

Roster is its own product. Two rules keep it that way:

1. **`coeso-communities/` is not part of Roster.** It is a separate app that
   lives in this working tree but has its own code, dependencies and deploy
   target. Do not fold its endpoints into the Roster Worker, and do not point
   Roster at its data.
2. **Roster owns its own database, secrets and domain.** Nothing here should
   depend on a shared demo instance, and no other product should read Roster's
   D1 database.

When Roster needs its own public identity (name, logo, support address, terms),
that belongs here, not in a shared site.

---

## 8. Pre-release checklist

- [ ] `cd frontend && npm test` → 53 passing
- [ ] `cd frontend && npm run build` → clean
- [ ] `esbuild` bundle regenerated from current `worker/src`
- [ ] `sites-deploy/dist` refreshed from `frontend/dist`
- [ ] Schema migrations applied to the remote D1 **before** deploying code that needs them
- [ ] Fresh D1 export taken if the release touches data
- [ ] Production smoke test: login, `/api/reps`, `/api/reports`, one write
- [ ] Access control confirms `401` (no token), `403` (foreign workspace)

## 9. Known gaps

- Billing checkout and plan changes return `501 NOT_AVAILABLE` — no payment
  provider is wired up. The pricing page is informational until one is added.
- Discord sign-in returns `501` until a Discord application is configured.
- `/api/digest` returns `404` until the first weekly digest is built. This is
  the documented contract, not an error.
- Office-hour slot booking is available; automated calendar invites are not.
