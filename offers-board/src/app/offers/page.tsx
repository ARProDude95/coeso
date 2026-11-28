import Link from "next/link";
import { Suspense } from "react";
import { BoardBrowser } from "@/components/board-browser";
import { getSession } from "@/lib/auth";
import { boardStats, listAppliedOfferIds, listOffers, type Offer } from "@/lib/store";
import {
  ROLE_LABELS,
  isNewThisWeek,
  isTakingApplications,
  monogram,
} from "@/lib/offer-format";

export const dynamic = "force-dynamic";

/** The three promises the board makes, in the order a member meets them. */
const STEPS = [
  {
    title: "See the real split",
    body: "Commission, pay structure and what the business actually sells — on the card, before you give a call away.",
  },
  {
    title: "Apply in a minute",
    body: "Hours, timezone, where you have closed before. No CV, no cover letter, no recruiter in the middle.",
  },
  {
    title: "One answer, tracked",
    body: "Your application goes to the owner who posted it, and moves from received to hired in the open.",
  },
];

/**
 * The board reads D1 on every request, so the shell is split from the data:
 * the hero and its counters render as soon as the small stats query returns,
 * and the two things that need the full offer list stream in behind their own
 * Suspense boundaries. No loading.tsx — that segment boundary never reveals
 * itself on this runtime, while an in-page boundary is a plain React suspense.
 */
export default async function BoardPage() {
  const stats = await boardStats();
  // One query shared by both streamed sections, started but not awaited here.
  const offers = listOffers({});

  const tiles = [
    { label: "Open offers", value: stats.open, note: "live now", hot: true },
    { label: "New this week", value: stats.fresh, note: "posted in 7 days" },
    { label: "Applications", value: stats.applications, note: "sent to owners" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-5">
      <section className="relative isolate -mx-5 overflow-hidden border-b border-line px-5 py-16 sm:py-24">
        {/* Warm light from the top and a hairline grid that fades out — both
            purely decorative, so they stay out of the accessibility tree. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute -top-64 left-1/2 h-[30rem] w-[52rem] -translate-x-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, rgba(242,236,221,0.18), rgba(242,236,221,0))",
              filter: "blur(12px)",
            }}
          />
          {/* A second, cool light behind the featured card: sage, not a new hue. */}
          <div
            className="absolute -top-40 right-[-12%] h-[26rem] w-[26rem] rounded-full opacity-70"
            style={{
              background:
                "radial-gradient(closest-side, rgba(164,189,173,0.16), rgba(164,189,173,0))",
              filter: "blur(18px)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(16,23,27,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,23,27,0.55) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
              maskImage:
                "radial-gradient(ellipse at 50% 0%, black 0%, transparent 68%)",
              WebkitMaskImage:
                "radial-gradient(ellipse at 50% 0%, black 0%, transparent 68%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />
        </div>

        <div className="grid gap-12 lg:grid-cols-[1.12fr_0.88fr] lg:items-start lg:gap-16">
          <div>
            <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
              <span
                aria-hidden="true"
                className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-ember"
              />
              Coeso · Offers Board
            </p>

            <h1 className="mt-6 max-w-2xl font-display text-5xl leading-[0.95] sm:text-7xl">
              Offers worth <span className="text-warm italic">closing.</span>
            </h1>

            <div
              aria-hidden="true"
              className="mt-7 h-px w-28 bg-gradient-to-r from-ember/70 via-sand/40 to-transparent"
            />

            <p className="mt-6 max-w-xl text-base leading-relaxed text-mute">
              Open setter and closer roles from businesses inside Coeso. Read
              the offer, see the split, apply in under a minute.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="pill border-ember/45 text-ember">
                <span
                  aria-hidden="true"
                  className="h-1 w-1 rounded-full bg-sage"
                />
                Invite only
              </span>
              <span className="pill">Vetted businesses</span>
              <span className="pill">
                {stats.open === 1 ? "1 role open" : `${stats.open} roles open`}
              </span>
            </div>

            <dl className="mt-10 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  data-tone={
                    tile.hot ? undefined : tile.label === "New this week" ? "sage" : "deep"
                  }
                  className="stat-tile flex items-baseline justify-between gap-3 p-4 sm:block sm:p-5"
                >
                  <dt className="eyebrow">{tile.label}</dt>
                  <dd className="font-display text-2xl leading-none tabular-nums sm:mt-3 sm:text-4xl">
                    <span className={tile.hot ? "text-ember" : "text-paper"}>
                      {tile.value}
                    </span>
                  </dd>
                  <p className="mt-2 hidden font-mono text-[9px] uppercase tracking-[0.2em] text-mute/75 sm:block">
                    {tile.note}
                  </p>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:pt-2">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow eyebrow-ember">Newest on the board</p>
              <span className="eyebrow">Live</span>
            </div>

            <Suspense fallback={<FeaturedSkeleton />}>
              <FeaturedOffer offers={offers} />
            </Suspense>
          </div>
        </div>

        <section
          aria-label="How the board works"
          className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3"
        >
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="group bg-coal p-5 transition-colors hover:bg-coal-soft"
            >
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
                {`0${index + 1}`}
                <span
                  aria-hidden="true"
                  className="h-px w-6 bg-gradient-to-r from-ember/70 to-transparent transition-all duration-200 group-hover:w-10"
                />
              </p>
              <p className="mt-3 font-display text-lg leading-snug text-paper">
                {step.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-mute">
                {step.body}
              </p>
            </div>
          ))}
        </section>
      </section>

      <Suspense fallback={<BoardSkeleton />}>
        <BoardList offers={offers} />
      </Suspense>
    </main>
  );
}

/** The featured card, streamed once the offer list arrives. */
async function FeaturedOffer({ offers }: { offers: Promise<Offer[]> }) {
  const list = await offers;
  const featured =
    list.find((offer) => offer.featured && isTakingApplications(offer)) ??
    list.find((offer) => isTakingApplications(offer)) ??
    null;

  if (!featured) {
    return (
      <div className="card mt-4 p-6">
        <p className="font-display text-xl leading-snug">
          Every role is filled right now.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          New offers land here first, and they go to the whole board at once —
          no early access tier.
        </p>
      </div>
    );
  }

  return (
    <>
      <Link
        href={`/offers/${featured.id}`}
        className="card card-link group mt-4 block overflow-hidden"
      >
        <div
          className="flex items-start gap-4 border-b border-line px-5 py-4"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(242,236,221,0.10), rgba(242,236,221,0))",
          }}
        >
          <span className="monogram" aria-hidden="true">
            {monogram(featured.company)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] uppercase tracking-[0.22em] text-paper/90">
              {featured.company}
            </p>
            <p className="eyebrow mt-1.5">
              {ROLE_LABELS[featured.role_type]} · {featured.pay_type}
            </p>
          </div>
          {isNewThisWeek(featured.created_at) ? (
            <span className="pill shrink-0 border-ember/50 py-0.5 text-ember">
              New
            </span>
          ) : null}
        </div>

        <div className="p-5">
          <h2 className="font-display text-2xl leading-[1.15] transition-colors group-hover:text-ember">
            {featured.title}
          </h2>

          <div className="mt-5 flex flex-col items-start gap-3 border-t border-line pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="eyebrow">Commission</p>
              <p className="mt-2 font-display text-2xl leading-none tracking-tight text-ember">
                {featured.commission}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-paper/70 transition-colors group-hover:text-ember">
              View offer →
            </span>
          </div>
        </div>
      </Link>

      <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.2em] text-mute/70">
        Commission is set by the owner, not negotiated by us.
      </p>
    </>
  );
}

/** The filters and the offer cards, streamed after the shell is on screen. */
async function BoardList({ offers }: { offers: Promise<Offer[]> }) {
  const session = await getSession();
  const [list, appliedOfferIds] = await Promise.all([
    offers,
    session ? listAppliedOfferIds(session.id) : Promise.resolve([]),
  ]);

  return <BoardBrowser offers={list} appliedOfferIds={appliedOfferIds} />;
}

/** Same footprint as the featured card, so the hero does not jump. */
function FeaturedSkeleton() {
  return (
    <div className="card mt-4 p-5" aria-hidden="true">
      <div className="flex items-start gap-4 border-b border-line pb-4">
        <div className="skeleton h-11 w-11 shrink-0 rounded-[11px]" />
        <div className="min-w-0 flex-1">
          <div className="skeleton h-2.5 w-24" />
          <div className="skeleton mt-2.5 h-2.5 w-32" />
        </div>
      </div>
      <div className="pt-5">
        <div className="skeleton h-6 w-3/4" />
        <div className="mt-5 border-t border-line pt-4">
          <div className="skeleton h-2.5 w-20" />
          <div className="skeleton mt-2.5 h-7 w-40" />
        </div>
      </div>
    </div>
  );
}

/** Filter row plus card shapes, matching the board's own grid. */
function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the board…</span>
      <div className="mt-10 flex gap-2">
        <div className="skeleton h-10 flex-1" />
        <div className="skeleton h-10 w-32" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card p-6">
            <div className="skeleton h-2.5 w-24" />
            <div className="skeleton mt-5 h-6 w-3/4" />
            <div className="skeleton mt-8 h-8 w-32" />
            <div className="skeleton mt-6 h-2.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
