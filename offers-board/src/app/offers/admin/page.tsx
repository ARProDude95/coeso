import { adminConfigured, isAdmin } from "@/lib/auth";
import { boardStats, listApplications, listOffers } from "@/lib/store";
import { AdminLogin } from "@/components/admin-login";
import { LogoutButton } from "@/components/logout-button";
import { OfferForm } from "@/components/offer-form";
import { StatusToggle } from "@/components/status-toggle";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-md px-5 py-20">
        <AdminLogin configured={adminConfigured()} />
      </main>
    );
  }

  const [offers, applications, stats] = await Promise.all([
    listOffers({ includeClosed: true }),
    listApplications(),
    boardStats(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
            Admin
          </p>
          <h1 className="mt-3 font-display text-4xl">Control room</h1>
        </div>
        <LogoutButton />
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Open offers", stats.open],
          ["Total offers", stats.total],
          ["Applications", stats.applications],
          ["New this week", stats.fresh],
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
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
              <tr>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Posted</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td className="px-4 py-3">{offer.title}</td>
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
                  <td className="px-4 py-3 text-right">
                    <StatusToggle id={offer.id} status={offer.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
