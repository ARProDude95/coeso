import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OfferForm } from "@/components/offer-form";
import { getSession } from "@/lib/auth";
import { getOffer } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EditOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/login");

  const { id } = await params;
  const offer = await getOffer(id);
  if (!offer) notFound();

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <Link
        href="/admin"
        className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute hover:text-paper"
      >
        ← Control room
      </Link>

      <div className="mt-6 border-b border-line pb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
          Edit offer
        </p>
        <h1 className="mt-3 font-display text-4xl">{offer.title}</h1>
        <p className="mt-2 text-sm text-mute">
          {offer.company} · {offer.status} · posted{" "}
          {new Date(offer.created_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="card mt-8 p-6">
        <OfferForm offer={offer} />
      </div>
    </main>
  );
}
