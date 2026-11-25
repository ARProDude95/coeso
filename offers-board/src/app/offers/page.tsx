import Link from "next/link";
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

  return (
    <main className="mx-auto max-w-6xl px-5">
      <section className="border-b border-line py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
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
            <dt className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
              Open offers
            </dt>
            <dd className="mt-2 font-display text-3xl">{stats.open}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
              New this week
            </dt>
            <dd className="mt-2 font-display text-3xl">{stats.fresh}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
              Applications
            </dt>
            <dd className="mt-2 font-display text-3xl">{stats.applications}</dd>
          </div>
        </dl>
      </section>

      <section className="py-10">
        <form action="/offers" className="flex flex-col gap-3 sm:flex-row">
          {cleanRole !== "all" ? (
            <input type="hidden" name="role" value={cleanRole} />
          ) : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search title, company, keywords…"
            aria-label="Search offers"
            className="field sm:flex-1"
          />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(ROLE_LABELS).map(([key, label]) => (
            <Link
              key={key}
              href={boardHref({ q, role: key })}
              className={`pill ${cleanRole === key ? "pill-active" : ""}`}
            >
              {label}
            </Link>
          ))}
        </div>

        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
          {offers.length} {offers.length === 1 ? "offer" : "offers"}
          {q ? ` matching “${q}”` : ""}
        </p>

        {offers.length === 0 ? (
          <div className="card mt-4 px-6 py-16 text-center">
            <p className="font-display text-2xl">
              Nothing on the board for that search.
            </p>
            <p className="mt-2 text-sm text-mute">
              Try a different keyword or{" "}
              <Link className="text-ember underline" href="/offers">
                clear the filters
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {offers.map((offer) => (
              <Link
                key={offer.id}
                href={`/offers/${offer.id}`}
                className="card group flex flex-col p-6 transition hover:border-ember/70"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
                    {offer.role_type} role
                  </span>
                  {offer.featured ? (
                    <span className="rounded-full bg-ember px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-ink">
                      Featured
                    </span>
                  ) : null}
                </div>
                <p className="mt-5 text-[11px] uppercase tracking-[0.22em] text-mute">
                  {offer.company}
                </p>
                <h2 className="mt-1 font-display text-2xl leading-snug transition group-hover:text-ember">
                  {offer.title}
                </h2>
                <p className="mt-4 text-sm font-medium text-ember">
                  {offer.commission}
                </p>
                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-mute">
                  {offer.description}
                </p>
                <div className="mt-auto flex items-center justify-between pt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
                  <span>{offer.pay_type}</span>
                  <span className="text-paper opacity-0 transition group-hover:opacity-100">
                    Open →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
