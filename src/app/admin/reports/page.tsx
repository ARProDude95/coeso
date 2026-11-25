import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { ReportActions } from "@/components/report-actions";
import { requireAdminInStaff } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { listReports, REPORT_THRESHOLD } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Reports",
};

const STATUS_BADGE: Record<string, string> = {
  open: "badge badge-pending",
  dismissed: "badge badge-neutral",
};

const OFFER_BADGE: Record<string, string> = {
  open: "badge badge-open",
  paused: "badge badge-paused",
  closed: "badge badge-closed",
};

async function ReportsList() {
  await requireAdminInStaff();
  const reports = await listReports();

  if (reports.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">No reports — the board is clean.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reports.map((report) => (
        <li key={report.id} className="panel p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={STATUS_BADGE[report.status]}>{report.status}</span>
            <span className={OFFER_BADGE[report.offerStatus]}>
              offer {report.offerStatus}
            </span>
            <span className="text-xs text-zinc-500">
              {report.reporterName} · {formatRelative(report.createdAt)}
            </span>
            <Link
              href={`/offers/${report.offerId}`}
              className="ml-auto truncate text-sm font-semibold text-zinc-100 hover:text-indigo-300"
            >
              {report.offerTitle}
            </Link>
          </div>

          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
            {report.reason}
          </p>

          <div className="mt-4 border-t border-zinc-800 pt-4">
            <ReportActions
              reportId={report.id}
              offerId={report.offerId}
              offerStatus={report.offerStatus}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="skeleton h-36 w-full" />
      ))}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader
        title="Reports"
        description={`${REPORT_THRESHOLD} unique open reports auto-pause an offer; admins are alerted in-app and by webhook.`}
      />
      <AdminNav current="reports" />
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsList />
      </Suspense>
    </div>
  );
}
