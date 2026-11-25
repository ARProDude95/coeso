import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth";
import { listApplicationsForUser } from "@/lib/applications";
import { formatRelative, isExpired } from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  OFFER_STATUS_LABELS,
  type ApplicationWithOffer,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "My applications",
};

const STATUS_BADGE: Record<ApplicationWithOffer["status"], string> = {
  pending: "badge badge-pending",
  accepted: "badge badge-accepted",
  rejected: "badge badge-rejected",
};

function ApplicationRow({ application }: { application: ApplicationWithOffer }) {
  const offerClosed = application.offer.status === "closed";

  return (
    <li className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">
            <Link
              href={`/offers/${application.offer.id}`}
              className="hover:text-indigo-300"
            >
              {application.offer.title}
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {application.offer.company}
            {offerClosed && (
              <span className="ml-2 text-xs text-zinc-500">
                (offer {OFFER_STATUS_LABELS[application.offer.status].toLowerCase()}
                {isExpired(application.offer.expiresAt) ? ", expired" : ""})
              </span>
            )}
          </p>
        </div>
        <span className={STATUS_BADGE[application.status]}>
          {APPLICATION_STATUS_LABELS[application.status]}
        </span>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">
        {application.message}
      </p>

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">Level</dt>
          <dd>{EXPERIENCE_LEVEL_LABELS[application.experienceLevel]}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">Availability</dt>
          <dd>{application.availabilityHours} hrs/week</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">Applied</dt>
          <dd>{formatRelative(application.createdAt)}</dd>
        </div>
      </dl>
    </li>
  );
}

async function ApplicationsList() {
  const ctx = await requireMember();
  const applications = await listApplicationsForUser(ctx.user.id);

  if (applications.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm font-medium text-zinc-200">
          You haven&apos;t applied to anything yet
        </p>
        <p className="max-w-sm text-sm text-zinc-500">
          Browse the board and apply to the offers that match your role — you
          can track every application here.
        </p>
        <Link href="/offers" className="btn btn-primary mt-1">
          Browse offers
        </Link>
      </div>
    );
  }

  const counts = applications.reduce(
    (acc, application) => {
      acc[application.status] += 1;
      return acc;
    },
    { pending: 0, accepted: 0, rejected: 0 },
  );

  return (
    <>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {(
          [
            ["Pending", counts.pending, "text-indigo-200"],
            ["Accepted", counts.accepted, "text-emerald-300"],
            ["Rejected", counts.rejected, "text-red-300"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="panel p-4">
            <p className={`text-2xl font-semibold ${color}`}>{value}</p>
            <p className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500">
              {label}
            </p>
          </div>
        ))}
      </div>

      <ul className="flex flex-col gap-4">
        {applications.map((application) => (
          <ApplicationRow key={application.id} application={application} />
        ))}
      </ul>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="skeleton h-40 w-full" />
      ))}
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          My applications
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every offer you&apos;ve applied to and where each one stands.
        </p>
      </div>

      <Suspense fallback={<ListSkeleton />}>
        <ApplicationsList />
      </Suspense>
    </div>
  );
}
