import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountsManager } from "@/components/accounts-manager";
import { DeleteButton } from "@/components/delete-button";
import { LogoutButton } from "@/components/logout-button";
import { OfferForm } from "@/components/offer-form";
import { StatusToggle } from "@/components/status-toggle";
import { getSession } from "@/lib/auth";
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

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/login");

  const [offers, applications, stats, accounts] = await Promise.all([
    listOffers({ includeClosed: true }),
    listApplications(),
    boardStats(),
    listAccounts(),
  ]);

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
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
              <tr>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Posted</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/offers/${offer.id}`}
                      className="hover:text-ember"
                    >
                      {offer.title}
                    </Link>
                    {offer.featured ? (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.18em] text-ember">
                        featured
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-mute">{offer.company}</td>
                  <td className="px-4 py-3 text-mute">{offer.role_type}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        offer.status === "open" ? "text-ember" : "text-mute"
                      }
                    >
                      {offer.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mute">
                    {formatDate(offer.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-4">
                      <Link
                        href={`/admin/offers/${offer.id}`}
                        className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper"
                      >
                        Edit
                      </Link>
                      <StatusToggle id={offer.id} status={offer.status} />
                      <DeleteButton
                        path={`/api/offers/${offer.id}`}
                        confirmText={`Delete "${offer.title}"? This cannot be undone.`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
          Applications ({applications.length})
        </h2>
        {applications.length === 0 ? (
          <p className="mt-4 text-sm text-mute">
            No applications yet. They appear here as soon as someone applies.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Discord</th>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Hours / wk</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td className="px-4 py-3">{application.name}</td>
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
