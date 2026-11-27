/**
 * Page-shaped placeholder shown while a route's data loads. The board reads D1
 * on every request, so a blank screen for half a second reads as a broken link;
 * this keeps the layout in place instead.
 */
export function PageSkeleton({
  cards = 4,
  withFilters = false,
}: {
  cards?: number;
  withFilters?: boolean;
}) {
  return (
    <main className="mx-auto max-w-6xl px-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse">
        <div className="border-b border-line py-16 sm:py-24">
          <div className="h-3 w-40 rounded bg-line" />
          <div className="mt-6 h-12 w-2/3 max-w-md rounded bg-line" />
          <div className="mt-4 h-4 w-1/2 max-w-sm rounded bg-line" />
        </div>

        {withFilters ? (
          <div className="mt-10 flex gap-2">
            <div className="h-10 flex-1 rounded-[10px] bg-line" />
            <div className="h-10 w-32 rounded-[10px] bg-line" />
          </div>
        ) : (
          <div className="mt-10 max-w-sm">
            <div className="h-6 w-56 rounded bg-line" />
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: cards }).map((_, index) => (
            <div key={index} className="card p-6">
              <div className="h-3 w-24 rounded bg-line" />
              <div className="mt-5 h-6 w-3/4 rounded bg-line" />
              <div className="mt-8 h-8 w-32 rounded bg-line" />
              <div className="mt-6 h-3 w-full rounded bg-line" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
