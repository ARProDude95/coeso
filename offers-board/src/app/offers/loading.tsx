/**
 * Board skeleton. Mirrors the real page's rhythm — hero, filter bar, card
 * grid — so the swap to content does not shift anything.
 */
export default function BoardLoading() {
  return (
    <main
      className="mx-auto max-w-6xl px-5"
      aria-busy="true"
      aria-label="Loading offers"
    >
      <section className="border-b border-line py-16 sm:py-24">
        <div className="skeleton h-3 w-44" />
        <div className="mt-6 space-y-3">
          <div className="skeleton h-12 w-[min(100%,28rem)] sm:h-16" />
          <div className="skeleton h-12 w-[min(70%,18rem)] sm:h-16" />
        </div>
        <div className="mt-6 space-y-2">
          <div className="skeleton h-3.5 w-full max-w-md" />
          <div className="skeleton h-3.5 w-64" />
        </div>
        <div className="mt-10 grid max-w-2xl grid-cols-3 gap-6 border-t border-line pt-6">
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <div className="skeleton h-2.5 w-20" />
              <div className="skeleton mt-3 h-7 w-12" />
            </div>
          ))}
        </div>
      </section>

      <div className="border-b border-line py-3 sm:border-0 sm:pt-10">
        <div className="flex gap-2">
          <div className="skeleton h-11 flex-1" />
          <div className="skeleton h-11 w-24" />
        </div>
        <div className="mt-3 flex gap-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-7 w-24 rounded-full" />
          ))}
        </div>
      </div>

      <section className="py-8 sm:py-10">
        <div className="skeleton h-2.5 w-28" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="card p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div className="skeleton h-11 w-11 rounded-[11px]" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-32" />
                  <div className="skeleton h-2.5 w-20" />
                </div>
              </div>
              <div className="skeleton mt-6 h-6 w-4/5" />
              <div className="mt-6 border-t border-line pt-5">
                <div className="skeleton h-2.5 w-24" />
                <div className="skeleton mt-3 h-7 w-40" />
              </div>
              <div className="mt-5 space-y-2">
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-2/3" />
              </div>
              <div className="mt-6 border-t border-line pt-4">
                <div className="skeleton h-2.5 w-24" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
