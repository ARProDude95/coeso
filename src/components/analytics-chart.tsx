import { barPercent, type DailyPoint } from "@/lib/analytics";

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Bars({
  series,
  field,
  className,
}: {
  series: DailyPoint[];
  field: "views" | "applications";
  className: string;
}) {
  const max = Math.max(...series.map((point) => point[field]), 0);

  return (
    <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`${field} over the last ${series.length} days`}>
      {series.map((point) => (
        <div
          key={point.date}
          className={`min-w-0 flex-1 rounded-t-sm ${className}`}
          style={{ height: `${barPercent(point[field], max)}%` }}
          title={`${shortDate(point.date)}: ${point[field]} ${field}`}
        />
      ))}
    </div>
  );
}

/** 30-day analytics chart: views above, applications below, shared x-axis. */
export function AnalyticsChart({ series }: { series: DailyPoint[] }) {
  if (series.length === 0) return null;

  const totalViews = series.reduce((sum, point) => sum + point.views, 0);
  const totalApps = series.reduce((sum, point) => sum + point.applications, 0);

  return (
    <div className="panel flex flex-col gap-5 p-5">
      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Views
          </h3>
          <span className="text-xs text-zinc-500">{totalViews} in 30 days</span>
        </div>
        <div className="mt-2">
          <Bars series={series} field="views" className="bg-indigo-500/80" />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Applications
          </h3>
          <span className="text-xs text-zinc-500">{totalApps} in 30 days</span>
        </div>
        <div className="mt-2">
          <Bars series={series} field="applications" className="bg-emerald-500/80" />
        </div>
      </div>

      <div className="flex justify-between border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
        <span>{shortDate(series[0].date)}</span>
        <span>{shortDate(series[Math.floor(series.length / 2)].date)}</span>
        <span>{shortDate(series[series.length - 1].date)}</span>
      </div>
    </div>
  );
}
