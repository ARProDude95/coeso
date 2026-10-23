# PROGRESS — Coeso session handoff (updated 2026-10-20)

Handoff for whoever continues. Read this before touching anything.

## Stack reality check

The original brief described "Next.js + Prisma + Postgres". **The actual repo
is Spring Boot (Java 21, MySQL 8, Flyway, Maven) + React 19 / TypeScript /
Vite.** Everything was built in the existing stack per the "follow existing
conventions, don't rewrite" rule. Frontend pages are workspace-scoped through
the `X-Workspace` header the API client sets from the session; every backend
service reads the workspace from `TenantContext`, never from the request body.

## Done (all committed, all tests green)

| # | Feature | Commit(s) | Tests |
| --- | --- | --- | --- |
| 1 | Paywall hardening — Razorpay provider behind the `BillingProvider` seam: signature verified before parse, idempotent webhook (payment success / failure / cancellation / renewal), access gating already covered by existing role matrix | `b80cc09` | `RazorpayWebhookTest` (7), `Phase4BillingTest` (7) |
| 2 | Paid office hours — expert flag on memberships, slots with duration + INR price, PENDING booking → Razorpay order → confirmed only by verified webhook, cancellation/refund state machine with append-only payout ledger (negative refund reversals), per-space commission (`workspaces.office_hours_commission_bp`, default 1000 = 10%), pasteable meeting link, audit rows | `530f1a2` | `OfficeHoursTest` (6) |
| 3 | Smart intros — `member_profiles` (offering / looking-for tags + industry), bidirectional tag-overlap scorer (+20 shared industry), ≤5 suggestions with one-line reason, max 3 pending requests, contact revealed only on accept to the pair, Discord notifications, cross-workspace isolation | `09bbece` | `IntrosTest` (4) |
| 4 | Mastermind pods — deterministic industry- then revenue-stage-adjacent preview (preview == publish output; `member_profiles.revenue_stage`, V10), manual draft overrides validated against active membership, previous generation archived on republish, private pod reads (members + admins), private message thread (`pod_messages`, V10), weekly wins/blockers/ask check-ins (one per ISO week → 409), consecutive-Monday attendance streaks | `9a7f92b` + V10 commit | `PodsTest` (6) |
| 5 | Frontend UIs — `/office-hours`, `/intros`, `/pods` pages + nav entries + typed API client, matching existing design (cards, lookup rows, pills, btn classes) | `bfd4f7f` | `community-features.test.tsx` (7) |
| 6 | Engagement snapshots + churn dashboard (weighted 30-day window, nightly job, DROP/INACTIVE signals, owner-only reads, Discord nudge seam) + templated weekly digest (`Summarizer` seam, `digest_logs`, Mondays 08:00), `/engagement` UI | uncommitted | `EngagementTest` (3), `DigestTest` (4), `engagement.test.tsx` (2) |

**Verification status:**
- Backend: `mvn test` full suite — **131 tests, 0 failures, 0 errors** (21
  suites).
- Frontend: `npm test` — **46 tests, 10 files, clean exit**; `tsc -b` clean.
- Webhook idempotency, tenant isolation, and role gating are asserted in the
  per-feature suites above.
- Live smokes against the running stack (both repeatable, both exit non-zero
  on failure): `./smoke-test.sh` (register → pipeline board → move → 401/403
  negatives → cleanup) and `./smoke-community.sh` (intros profile → invite
  create/list/accept + single-use token → deterministic pod generation +
  publish → private thread: member read, blank 400, outsider 403 → cleanup;
  37 asserts, fresh timestamped data per run). `smoke-community.sh` drives
  the Vite proxy when :5173 is up and falls back to :8080 directly.
  Verified 2026-10-22: three consecutive runs green (full stack ×2,
  backend-only fallback ×1).
- Feature 5 live-verified 2026-10-22 against the running stack (through the
  frontend origin): 34/34 checks — refresh → dashboard (a fresh workspace has
  no signals; a seeded yesterday=100 / today=2 + 20d-silent member fires
  DROP+INACTIVE with previousScore), the nudge reason rendered from the
  snapshot through the Discord seam (NoOp without a bot token), digest build
  → idempotent rebuild (same id) → GET, and 401/403 negatives (rep blocked
  from dashboard and digest, foreign workspace refused). UI evidence in
  `screenshots/engagement-live.png` + `engagement-live-nudge.png` (dashboard
  with pills, and the "nudge sent" confirmation). Suites at the same moment:
  backend 131, frontend 46, `tsc --noEmit` clean.

## In progress / not started

- **Feature 5 from the brief (churn-risk alerts + weekly digest) — DONE,
  uncommitted.** Engagement snapshots + churn dashboard with the Discord
  nudge seam (`EngagementService`/`EngagementJob`/`EngagementController`,
  `engagement_snapshots` in V11) and the templated weekly digest
  (`DigestService`/`DigestJob`/`DigestController` + `Summarizer`,
  `digest_logs`); UI at  `/engagement`, README sections written, tests: `EngagementTest` (3),
  `DigestTest` (4), frontend `engagement.test.tsx` (2). Live-verified against
  the running stack 2026-10-22 (34/34 checks + UI screenshots) — see
  Verification status.
- **Static preview published to Freebuff Sites** (frontend only — the Spring
  Boot API is not part of the Workers deployment; `/api/*` answers a JSON
  503 by design). Bundle + manifest in `sites-deploy/`.

## Next steps (for the next session)

1. **Commit the batch:** feature-5 work (engagement + digest), the pods
   revenue-stage balance change, the purge fix + `WorkspacePurgeTest`, the
   `smoke-community.sh` script, the README/PROGRESS updates, and the
   `sites-deploy/` bundle. Suites are green (backend 131, frontend 46).
2. ~~Known issue: `WorkspacePurgeJob.CHILD_TABLES`~~ — **fixed and live-
   verified 2026-10-22** (see "Known issues"); nothing to do.

## Assumptions made (per brief: decide, don't ask)

- **"Expert" flag** lives on `memberships.expert` (V7), settable by owner /
  admin via `PUT /api/office-hours/members/{userId}/expert`.
- **Commission** default 1000 basis points (10%), owner-editable per space,
  clamped 0–5000 server-side.
- **Currency** for office hours is INR minor units (paise) everywhere;
  Razorpay order created server-side; booking stays PENDING until the
  verified webhook confirms (503 with a clear code when Razorpay keys are
  unset — same convention as Stripe).
- **Meeting link** is a free-text URL the expert pastes; no video-provider
  integration.
- **Pod size** 2–8; grouping sorts **industry-major then by revenue
  stage** (both live on `member_profiles`; the stage column arrived in V10
  alongside the pod thread) and balances by stage: whole industry+stage
  cohorts are packed into pods first-fit, a cohort is split only when it
  alone exceeds 8 members (then into near-equal parts via the n/6
  rounding), and a pod is never closed at a single member. Members without
  either profile dimension group into the "general" bucket; pods < 2
  members are refused on publish; validation checks *active membership*,
  not profile presence.
- **Pod thread**: `pod_messages` (V10) is the spec's "private thread" —
  plain messages scoped to the pod (members + workspace admins), no
  replies/reactions (not specified).
- **Intro contact reveal**: the accepted pair sees each other's login email
  (the only contact field the schema has).
- **Check-in week** normalizes any date to its ISO Monday; duplicate week →
  409.
- Feature 5 is deliberately **not [PRO]-gated**: the README/PROGRESS specs
  never mark the engagement dashboard or the digest [PRO], and features 2–4
  (office hours, intros, pods) are ungated too. The only hint otherwise is
  the pre-existing `PlanLimitService` comment "(Phase 7, 12)", written
  during Phase 7 before this feature existed. If the brief really reserves a
  PRO "phase 12" for it, gating is a deliberate follow-up (402 on free plans
  + an upgrade prompt in the UI + the jobs skipping free workspaces), not
  something to slip in silently.
- Test DB is `roster_test` on local MySQL (Testcontainers is unavailable in
  this environment; `application-test.yml` falls back to `ROSTER_TEST_DB_*`).
  If Flyway validation fails after a botched migration, drop and recreate
  `roster_test` — it is disposable: `DROP DATABASE roster_test; CREATE
  DATABASE roster_test ...`.

## Known issues

- **None open in features 1–5.** All suites green at time of writing.
- **FIXED 2026-10-22: `WorkspacePurgeJob` FK failure**
  (was pre-existing). The Phase 1 purge job's `CHILD_TABLES` whitelist was
  never extended past V1, so purging a workspace with rows in any later
  table died on the first FK violation (`Cannot delete or update a parent
  row…`) and those children were never removed — observed live 2026-10-20
  (`offer_required_skills` (V4) → `offers`). The whitelist now covers every
  tenant table from V1–V11 in FK-safe order and is exposed as
  `WorkspacePurgeJob.CHILD_TABLES` (note `ledger_entries` leads: it
  references activity_entries, commission_rules *and* payouts). Guarded by
  `WorkspacePurgeTest` (2): the list must equal information_schema's
  `workspace_id` tables exactly and place every FK child before its parent
  (so a future migration that forgets the list fails there), plus an
  end-to-end purge of the reported chain. Verified live against MySQL
  `roster`: the backend restart logged `Purged children of 4 deleted
  workspace(s)`, all four stuck workspaces (incl. ws13 with 50 audit rows,
  8 offers and the 5 blocking `offer_required_skills`) now hold zero child
  rows while their workspace rows remain as tombstones, active workspaces
  untouched, app health UP. No FK errors in the run log.
- The working tree contains **another session's uncommitted work** (Phase 8
  offer pipeline: `pipeline/`, `V6__offer_pipeline.sql`, `BoardPage.tsx`,
  Docker/Caddy deploy files, README/.env.example edits). It is *not* mine —
  do not stage or revert it wholesale; my commits deliberately excluded it
  (index-level partial staging). Its own tests (`Phase8PipelineTest`,
  `phase8-board.test.tsx`) were green when the full suites ran.

## New / changed env vars

- **No new env vars introduced by features 1–5.** They reuse the existing
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and
  `BILLING_PROVIDER` from `.env.example`.
- Correction pending in `.env.example`: comments still say Razorpay is "a
  documented stub" — it is now implemented (verify-before-parse webhook).
  The file is shared with the other session's edits; fix the comments when
  committing README/.env.example (documented next to this note).

## Quick reference: new endpoints

| Area | Endpoints | Min role |
| --- | --- | --- |
| office hours | `GET /api/office-hours/slots`, `/slots/mine`, `POST /slots`, `POST /slots/{id}/cancel`, `POST /slots/{id}/book`, `GET /bookings`, `POST /bookings/{id}/cancel`, `PUT /bookings/{id}/meeting-link`, `GET /payouts`, `POST /payouts/{id}/paid`, `GET/PUT /commission`, `GET /experts`, `PUT /members/{userId}/expert` | read: any member; slots/payouts: expert or manager+; commission: owner; expert flag: admin+ |
| payments webhook | `POST /api/payments/webhooks/razorpay` | public, signature-verified, outside the JWT chain |
| intros | `GET/PUT /api/intros/profile`, `GET /suggestions`, `POST /requests` (`{targetUserId, reason?}`), `GET /requests/incoming`, `/requests/outgoing`, `POST /requests/{id}/accept`, `/decline` | any member (accept/decline: target only, server-enforced) |
| pods | `POST /api/pods/generate`, `POST /publish`, `GET /api/pods`, `GET /{id}`, `POST /{id}/checkins`, `GET /{id}/checkins` | generate/publish: admin+; read: member's own pods (admins all); check-in: pod members only |
