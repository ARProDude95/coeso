import { BoardBrowser } from "@/components/board-browser";
import { getSession } from "@/lib/auth";
import { boardStats, listAppliedOfferIds, listOffers } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const session = await getSession();
  const [offers, stats, appliedOfferIds] = await Promise.all([
    listOffers({}),
    boardStats(),
    session ? listAppliedOfferIds(session.id) : Promise.resolve([]),
  ]);

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

      <BoardBrowser offers={offers} appliedOfferIds={appliedOfferIds} />
    </main>
  );
}
