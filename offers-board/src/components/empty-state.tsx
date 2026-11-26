import Link from "next/link";

export function EmptyState({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="card mt-4 px-6 py-14 text-center sm:py-20">
      <span className="monogram mx-auto" aria-hidden="true">
        ◇
      </span>
      <p className="eyebrow eyebrow-ember mt-5">{eyebrow}</p>
      <p className="mt-3 font-display text-2xl leading-snug">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mute">
        {body}
      </p>
      {action ? (
        <Link href={action.href} className="btn mt-6">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
