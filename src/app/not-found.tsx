import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl font-semibold tracking-tight text-zinc-700">404</p>
      <p className="text-sm text-zinc-400">
        That page or offer doesn&apos;t exist — it may have been removed.
      </p>
      <Link href="/offers" className="btn btn-primary">
        Back to offers
      </Link>
    </div>
  );
}
