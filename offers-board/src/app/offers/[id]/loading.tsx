/** Offer detail skeleton: article column plus the sticky apply card. */
export default function OfferLoading() {
  return (
    <main
      className="mx-auto max-w-6xl px-5"
      aria-busy="true"
      aria-label="Loading offer"
    >
      <div className="py-8">
        <div className="skeleton h-2.5 w-24" />
      </div>

      <div className="grid gap-10 border-t border-line pt-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="skeleton h-2.5 w-28" />
          <div className="mt-3 space-y-3">
            <div className="skeleton h-9 w-full max-w-xl" />
            <div className="skeleton h-9 w-3/4" />
          </div>
          <div className="mt-6 flex gap-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton h-7 w-24 rounded-full" />
            ))}
          </div>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="bg-coal px-5 py-4">
                <div className="skeleton h-2.5 w-20" />
                <div className="skeleton mt-3 h-3.5 w-28" />
              </div>
            ))}
          </div>
          <div className="mt-10 space-y-3">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="skeleton h-3.5 w-full" />
            ))}
            <div className="skeleton h-3.5 w-2/3" />
          </div>
        </div>

        <div className="card self-start p-6">
          <div className="skeleton h-2.5 w-24" />
          <div className="skeleton mt-4 h-7 w-48" />
          <div className="mt-3 space-y-2">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-5/6" />
          </div>
          <div className="skeleton mt-6 h-28 w-full rounded-xl" />
        </div>
      </div>
    </main>
  );
}
