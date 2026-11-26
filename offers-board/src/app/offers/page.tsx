import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { OfferCard } from "@/components/offer-card";
import { boardStats, listOffers } from "@/lib/store";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  all: "All roles",
  setter: "Setters",
  closer: "Closers",
  both: "Full cycle",
};

function boardHref(params: { q?: string; role?: string }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.role && params.role !== "all") search.set("role", params.role);
  const query = search.toString();
  return query ? `/offers?${query}` : "/offers";
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const { q = "", role = "all" } = await searchParams;
  const cleanRole = ["setter", "closer", "both"].includes(role) ? role : "all";

  const [offers, stats] = await Promise.all([
    listOffers({ q, role: cleanRole }),
    boardStats(),
  ]);

  const filtering = Boolean(q) || cleanRole !== "all";

  return (
    <main className="mx-auto max-w-6xl px-5">
      <section className="border-b border-line py-16 sm:py-24">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-ember"
          />
          Coeso · Offers Board
        </p>
        <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[0.95] sm:text-7xl">
          Offers worth <span className="italic text-ember">closing.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-mute">
          Open setter and closer roles from businesses inside Coeso. Read the
          offer, see the split, apply in under a minute.
        </p>
        <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-6 border-t border-line pt-6">
          <div>
            <dt className="eyebrow">Open offers</dt>
            <dd className="mt-2 font-display text-3xl leading-none">
              {stats.open}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">New this week</dt>
            <dd className="mt-2 font-display text-3xl leading-none">
              {stats.fresh}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Applications</dt>
            <dd className="mt-2 font-display text-3xl leading-none">
              {stats.applications}
            </dd>
          </div>
        </dl>
      </section>

      {/* Filters stick to the top of a phone screen while the cards scroll. */}
      <div className="sticky top-[61px] z-10 -mx-5 border-b border-line bg-ink/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-10 sm:backdrop-blur-none">
        <form action="/offers" className="flex gap-2">
          {cleanRole !== "all" ? (
            <input type="hidden" name="role" value={cleanRole} />
          ) : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search title, company, keywords…"
            aria-label="Search offers"
            className="field flex-1"
          />
          <button className="btn btn-primary shrink-0" type="submit">
            Search
          </button>
        </form>

        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-0.5 sm:mt-4 sm:flex-wrap sm:overflow-visible">
          {Object.entries(ROLE_LABELS).map(([key, label]) => (
            <Link
              key={key}
              href={boardHref({ q, role: key })}
              aria-current={cleanRole === key ? "page" : undefined}
              className={`pill shrink-0 ${cleanRole === key ? "pill-active" : ""}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <section className="py-8 sm:py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">
            {offers.length} {offers.length === 1 ? "offer" : "offers"}
            {q ? ` matching “${q}”` : ""}
          </p>
          {filtering ? (
            <Link
              href="/offers"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute underline decoration-line underline-offset-4 hover:text-paper"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        {offers.length === 0 ? (
          filtering ? (
            <EmptyState
              eyebrow="No matches"
              title="Nothing on the board for that search."
              body="Try a different keyword, or widen the role filter to see what else is live."
              action={{ href: "/offers", label: "Clear filters" }}
            />
          ) : (
            <EmptyState
              eyebrow="Board is quiet"
              title="No offers are live right now."
              body="Coeso’s Owner posts every offer here personally. When something opens, it lands on this board — check back soon."
            />
          )
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
