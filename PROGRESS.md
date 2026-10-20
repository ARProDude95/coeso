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
| 4 | Mastermind pods — deterministic industry-adjacent preview (preview == publish output), manual draft overrides validated against active membership, previous generation archived on republish, private pod reads (members + admins), weekly wins/blockers/ask check-ins (one per ISO week → 409), consecutive-Monday attendance streaks | `9a7f92b` | `PodsTest` (4) |
| 5 | Frontend UIs — `/office-hours`, `/intros`, `/pods` pages + nav entries + typed API client, matching existing design (cards, lookup rows, pills, btn classes) | `bfd4f7f` | `community-features.test.tsx` (7) |

**Verification status:**
- Backend: `mvn test` full suite — **118 tests, 0 failures, 0 errors** (18 suites).
- Frontend: `npm test` — **44 tests, 9 files, clean exit**; `tsc -b` clean.
- Webhook idempotency, tenant isolation, and role gating are asserted in the
  per-feature suites above.

## In progress / not started

- **Feature 5 from the brief (churn-risk alerts + weekly digest) — NOT
  started.** Time budget was spent on features 1–4 + their UIs. Next steps
  below describe the intended design.
- No deployment work attempted (no token available — per brief, skip it).

## Next steps (for the next session)

1. **Engagement score + churn alerts (~40 min):**
   - `engagement_snapshots` table (workspace_id, user_id, score, window
     metrics: posts/comments/logins/RSVPs over last 30 days) — a nightly job
     computes and stores them; owner dashboard lists members with a sharp
     drop vs the previous snapshot or 14+ days inactive, with a templated
     "Send nudge" button (reuse the existing `DiscordNotifier` seam; email
     when SMTP exists).
   - Follow `AuditService`/`LeaderboardService` patterns: scope every query
     by workspace, `@PreAuthorize("@roles.hasAtLeast('OWNER')")` on reads.
2. **Weekly digest (~20 min):** `digest_logs` table; a scheduled job
   (`@Scheduled`, guarded so tests disable it) builds a plain-text summary —
   top posts, new members, open deals — via a `Summarizer` interface with a
   templated default implementation and a `// TODO: plug an LLM in here`
   comment. Queue the email (no paid API dependency).
3. Run full suites + commit as usual; update README + this file.

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
- **Pod size** target 5–8 with near-equal chunking (n/6 rounded); members
  without an industry profile group into the "general" bucket; pods < 2
  members are refused on publish; validation checks *active membership*, not
  profile presence.
- **Intro contact reveal**: the accepted pair sees each other's login email
  (the only contact field the schema has).
- **Check-in week** normalizes any date to its ISO Monday; duplicate week →
  409.
- Test DB is `roster_test` on local MySQL (Testcontainers is unavailable in
  this environment; `application-test.yml` falls back to `ROSTER_TEST_DB_*`).
  If Flyway validation fails after a botched migration, drop and recreate
  `roster_test` — it is disposable: `DROP DATABASE roster_test; CREATE
  DATABASE roster_test ...`.

## Known issues

- **None open in features 1–5.** All suites green at time of writing.
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
