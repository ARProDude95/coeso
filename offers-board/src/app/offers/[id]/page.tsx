import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyForm } from "@/components/apply-form";
import { getSession } from "@/lib/auth";
import { getOffer, hasAppliedForOffer } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function OfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const offer = await getOffer(id);
  if (!offer) notFound();

  const session = await getSession();
  const applied = session ? await hasAppliedForOffer(offer.id, session.id) : false;

  const paragraphs = offer.description.split(/\n{2,}/).filter(Boolean);
  const requirements = offer.requirements
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  const posted = new Date(offer.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const facts: Array<[string, string]> = [
    ["Commission", offer.commission],
    ["Pay structure", offer.pay_type],
    ["Role", offer.role_type],
    ["Posted", posted],
  ];

  return (
    <main className="mx-auto max-w-6xl px-5">
      <div className="py-8">
        <Link
          href="/offers"
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute hover:text-paper"
        >
          ← All offers
        </Link>
      </div>

      <div className="grid gap-10 border-t border-line pt-10 lg:grid-cols-[1.6fr_1fr]">
        <article>
          <p className="text-[11px] uppercase tracking-[0.22em] text-mute">
            {offer.company}
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-4xl leading-[1.05] sm:text-5xl">
            {offer.title}
          </h1>

          <div className="mt-6 flex flex-wrap gap-2">
            <span className="pill">{offer.role_type} role</span>
            <span className="pill">{offer.pay_type}</span>
            {offer.status === "closed" ? (
              <span className="pill border-ember/60 text-ember">Closed</span>
            ) : null}
            {offer.featured ? (
              <span className="pill border-ember/60 text-ember">Featured</span>
            ) : null}
          </div>

          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="bg-coal px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
                  {label}
                </p>
                <p className="mt-1 text-sm">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 space-y-5 text-[15px] leading-relaxed text-paper/85">
            {paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
          </div>

          {requirements.length > 0 ? (
            <div className="mt-10">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
                What they need
              </h2>
              <ul className="mt-4 space-y-2 text-[15px] text-paper/85">
                {requirements.map((requirement) => (
                  <li key={requirement} className="flex gap-3">
                    <span className="text-ember">—</span>
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="card p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
              {offer.status === "open" ? "Interested?" : "Closed"}
            </p>

            {offer.status === "open" && applied ? (
              <>
                <h2 className="mt-3 font-display text-2xl">
                  Application received
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  Coeso’s Owner has your application for this offer and will
                  reply to the email you gave. Message{" "}
                  <span className="font-mono text-ember">a1rymn</span> on Discord
                  if you want to add anything.
                </p>
              </>
            ) : offer.status === "open" ? (
              <>
                <h2 className="mt-3 font-display text-2xl">
                  Apply for this role
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  Signed in as{" "}
                  <span className="font-mono text-paper">
                    {session?.username}
                  </span>
                  . Your application goes straight to Coeso’s Owner.
                </p>
                <ApplyForm offerId={offer.id} />
              </>
            ) : (
              <>
                <h2 className="mt-3 font-display text-2xl">
                  No longer taking interest
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  This offer has been closed.{" "}
                  <Link href="/offers" className="text-ember underline">
                    Browse the board
                  </Link>{" "}
                  for open roles.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
