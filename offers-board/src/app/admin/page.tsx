import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountsManager } from "@/components/accounts-manager";
import { ApplicationStatus } from "@/components/application-status";
import { CopyApplication } from "@/components/copy-application";
import { LogoutButton } from "@/components/logout-button";
import { OfferForm } from "@/components/offer-form";
import { OffersTable } from "@/components/offers-table";
import { getSession } from "@/lib/auth";
import { ensureDailyBackup, lastBackupAt } from "@/lib/backup";
import { notificationsConfigured } from "@/lib/notify";
import {
  boardStats,
  listAccounts,
  listApplications,
  listOffers,
} from "@/lib/store";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/login");

  const [offers, applications, stats, accounts] = await Promise.all([
    listOffers({ includeClosed: true }),
    listApplications(),
    boardStats(),
    listAccounts(),
  ]);

  // At most one snapshot a day: the backup happens while the owner is here.
  const backup = await ensureDailyBackup();
  const backedUpAt = await lastBackupAt();

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
            Admin
          </p>
          <h1 className="mt-3 font-display text-4xl">Control room</h1>
          <p className="mt-2 text-sm text-mute">
            Signed in as{" "}
            <span className="font-mono text-paper">{session.username}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/offers" className="btn">
            View board
          </Link>
          <LogoutButton />
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Open offers", stats.open],
          ["Total offers", stats.total],
          ["Members", accounts.length],
          ["Applications", stats.applications],
        ].map(([label, value]) => (
          <div key={label} className="card px-5 py-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
              {label}
            </dt>
            <dd className="mt-2 font-display text-3xl">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
          Post an offer
        </h2>
        <div className="card mt-4 p-6">
          <OfferForm />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
          Offers ({offers.length})
        </h2>
        <OffersTable offers={offers} />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
          Accounts ({accounts.length})
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">
          Only people you create here can sign in. Viewers can read the board
          and nothing else; accounts you disable or delete lose access
          immediately.
        </p>
        <div className="mt-4">
          <AccountsManager accounts={accounts} currentId={session.id} />
        </div>
      </section>

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
            Applications ({applications.length})
          </h2>
          <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.22em]">
            <a
              href="/api/applications/export"
              download
              className="text-ember underline decoration-ember/40 underline-offset-4 hover:text-paper"
            >
              Download CSV
            </a>
            <a
              href="/api/backup"
              download
              className="text-mute underline decoration-line underline-offset-4 hover:text-paper"
            >
              Full backup
            </a>
          </div>
        </div>
        <p className="mt-2 text-xs text-mute">
          {notificationsConfigured()
            ? "Each new application is also posted to your Discord webhook."
            : "Set DISCORD_WEBHOOK_URL to get a Discord ping for every new application."}
        </p>
        <p className="mt-1 text-xs text-mute">
          {backup.ok && backedUpAt
            ? `Snapshot stored off the database: ${formatDateTime(backedUpAt)}. The last 14 daily snapshots are kept; take the full backup for a copy of your own.`
            : "No snapshot stored yet — the backup bucket is not attached to this environment. Download the full backup instead."}
        </p>
        {applications.length === 0 ? (
          <p className="mt-4 text-sm text-mute">
            No applications yet. They appear here as soon as a signed-in member
            applies from an offer page.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Discord</th>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Hours / wk</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td className="px-4 py-3">
                      <span className="font-mono">{application.name}</span>
                      {application.message ? (
                        <p className="mt-1 max-w-xs text-xs leading-relaxed text-mute">
                          {application.message}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        className="text-ember underline"
                        href={`mailto:${application.email}`}
                      >
                        {application.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-mute">
                      {application.discord}
                    </td>
                    <td className="px-4 py-3 text-mute">
                      {application.offer_title}
                    </td>
                    <td className="px-4 py-3 text-mute">
                      {application.availability_hours}
                    </td>
                    <td className="px-4 py-3 text-mute">
                      {formatDate(application.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ApplicationStatus
                        id={application.id}
                        status={application.status}
                        offerId={application.offer_id}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CopyApplication application={application} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
