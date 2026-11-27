import Link from "next/link";
import { BoardBrowser } from "@/components/board-browser";
import { getSession } from "@/lib/auth";
import { boardStats, listAppliedOfferIds, listOffers } from "@/lib/store";
import { ROLE_LABELS, isNewThisWeek, monogram } from "@/lib/offer-format";

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

export default async function BoardPage() {
  const session = await getSession();
  const [offers, stats, appliedOfferIds] = await Promise.all([
    listOffers({}),
    boardStats(),
    session ? listAppliedOfferIds(session.id) : Promise.resolve([]),
  ]);

  const featured =
    offers.find((offer) => offer.featured && offer.status === "open") ??
    offers.find((offer) => offer.status === "open") ??
    null;

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
                "radial-gradient(closest-side, rgba(255,90,31,0.32), rgba(255,90,31,0))",
              filter: "blur(12px)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(36,39,45,0.75) 1px, transparent 1px), linear-gradient(to bottom, rgba(36,39,45,0.75) 1px, transparent 1px)",
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
              Offers worth <span className="italic text-ember">closing.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-mute">
              Open setter and closer roles from businesses inside Coeso. Read
              the offer, see the split, apply in under a minute.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="pill border-ember/45 text-ember">
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
                  className="relative flex items-baseline justify-between gap-3 overflow-hidden rounded-xl border border-line bg-coal p-4 sm:block sm:p-5"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-px"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(255,90,31,0.85), rgba(255,90,31,0))",
                    }}
                  />
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

            {featured ? (
              <Link
                href={`/offers/${featured.id}`}
                className="card card-link group mt-4 block overflow-hidden"
              >
                <div
                  className="flex items-start gap-4 border-b border-line px-5 py-4"
                  style={{
                    backgroundImage:
                      "linear-gradient(180deg, rgba(255,90,31,0.12), rgba(255,90,31,0))",
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
            ) : (
              <div className="card mt-4 p-6">
                <p className="font-display text-xl leading-snug">
                  Every role is filled right now.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  New offers land here first, and they go to the whole board at
                  once — no early access tier.
                </p>
              </div>
            )}

            <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.2em] text-mute/70">
              Commission is set by the owner, not negotiated by us.
            </p>
          </div>
        </div>

        <section
          aria-label="How the board works"
          className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3"
        >
          {STEPS.map((step, index) => (
            <div key={step.title} className="bg-coal p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
                {`0${index + 1}`}
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

      <BoardBrowser offers={offers} appliedOfferIds={appliedOfferIds} />
    </main>
  );
}
