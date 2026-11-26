import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { getSession } from "@/lib/auth";
import { listApplicationsForAccount, type ApplicationStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

const STEPS: ApplicationStatus[] = ["new", "reviewing", "shortlisted", "hired"];

const COPY: Record<
  ApplicationStatus,
  { label: string; hint: string; active: boolean }
> = {
  new: {
    label: "Received",
    hint: "Waiting for Coeso to pick it up.",
    active: true,
  },
  reviewing: {
    label: "In review",
    hint: "Coeso is reading your application.",
    active: true,
  },
  shortlisted: {
    label: "Shortlisted",
    hint: "You are through the first cut — expect a message.",
    active: true,
  },
  hired: {
    label: "Hired",
    hint: "You got the role. The offer is closed.",
    active: false,
  },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function MyApplicationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const applications = await listApplicationsForAccount(session.id);

  return (
    <main className="mx-auto max-w-4xl px-5">
      <section className="border-b border-line py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
          Coeso · Offers Board
        </p>
        <h1 className="mt-5 font-display text-4xl leading-[0.95] sm:text-5xl">
          My applications
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-mute">
          Everything you have applied to, and where it stands right now. Only{" "}
          <span className="font-mono text-paper">{session.username}</span> and
          Coeso&rsquo;s Owner can see this list.
        </p>
      </section>

      {applications.length === 0 ? (
        <EmptyState
          eyebrow="Nothing sent yet"
          title="Your applications will land here."
          body="Open an offer, apply in under a minute, and follow it from received to hired. Only you and Coeso’s Owner see this page."
          action={{ href: "/offers", label: "Browse offers" }}
        />
      ) : (
        <ul className="mt-8 divide-y divide-line">
          {applications.map((application) => {
            const copy = COPY[application.status];
            const reached = STEPS.indexOf(application.status);

            return (
              <li key={application.id} className="py-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-mute">
                      {application.offer_company}
                    </p>
                    <h2 className="mt-1 font-display text-2xl leading-snug">
                      <Link
                        href={`/offers/${application.offer_id}`}
                        className="hover:text-ember"
                      >
                        {application.offer_title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-xs text-mute">
                      Applied {formatDate(application.created_at)}
                      {application.offer_status === "closed"
                        ? " · offer closed"
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`pill ${
                      copy.active ? "border-ember/60 text-ember" : ""
                    }`}
                  >
                    {copy.label}
                  </span>
                </div>

                <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                  {STEPS.map((step, index) => (
                    <li key={step} className="flex items-center gap-2">
                      {index > 0 ? (
                        <span className="text-line">—</span>
                      ) : null}
                      <span
                        className={
                          index <= reached ? "text-paper" : "text-mute/50"
                        }
                      >
                        {COPY[step].label}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  {copy.hint}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-12 border-t border-line pt-6">
        <Link
          href="/offers"
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute hover:text-paper"
        >
          ← Back to the board
        </Link>
      </div>
    </main>
  );
}
