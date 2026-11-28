import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { monogram } from "@/lib/offer-format";
import { authConfigured, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DISCORD_HANDLE = "a1rymn";

/** Illustrative cards only — no board data is read for a signed-out visitor. */
const TEASER = [
  {
    company: "Northwind Growth",
    title: "High-ticket closer — B2B SaaS",
    commission: "18% of contract value",
  },
  {
    company: "Halden & Co",
    title: "Setter for a coaching offer",
    commission: "$120 per held call",
  },
  {
    company: "Palewood",
    title: "Full-cycle sales — DTC launch",
    commission: "20% first order",
  },
];

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/admin" : "/offers");

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <section className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-28 -left-16 h-72 w-[34rem] max-w-none"
            style={{
              background:
                "radial-gradient(closest-side, rgba(242,236,221,0.13), rgba(242,236,221,0))",
              filter: "blur(6px)",
            }}
          />
          <p className="relative font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
            Coeso · Offers Board
          </p>
          <h1 className="relative mt-6 max-w-lg font-display text-5xl leading-[0.95] sm:text-6xl">
            Members <span className="text-warm italic">only.</span>
          </h1>
          <div
            aria-hidden="true"
            className="relative mt-7 h-px w-28 bg-gradient-to-r from-ember/70 via-sand/40 to-transparent"
          />
          <p className="mt-6 max-w-md text-base leading-relaxed text-mute">
            The offers board is private. Every account is created by Coeso’s
            Owner and handed out personally — nobody can sign up from this page.
          </p>

          <div className="mt-10 space-y-4">
            <div className="card p-5 transition-colors hover:border-line-bright">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">
                No account yet?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-paper/85">
                You need to contact <strong>Coeso’s Owner</strong> in order to
                get access. Message{" "}
                <span className="font-mono text-ember">{DISCORD_HANDLE}</span> on
                Discord and they will set you up with a login.
              </p>
            </div>

            <div className="card border-ember/30 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
                Offer owner?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-paper/85">
                If you are an offer owner and want your offers posted on the
                board, contact{" "}
                <span className="font-mono text-ember">{DISCORD_HANDLE}</span> on
                Discord as well. Offers are only published by Coeso’s Owner.
              </p>
            </div>
          </div>
        </section>

        <section className="relative lg:pt-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-6 -top-4 bottom-0 -z-10 rounded-[28px]"
            style={{
              background:
                "radial-gradient(60% 60% at 70% 10%, rgba(242,236,221,0.12), rgba(242,236,221,0))",
            }}
          />
          <div className="card p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
              Sign in
            </p>
            <h2 className="mt-3 font-display text-3xl">Enter the board</h2>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              {authConfigured()
                ? "Use the username and password Coeso sent you."
                : "Set ADMIN_SECRET (and ADMIN_PASSWORD for the first admin) on this deployment to enable sign-in."}
            </p>
            <LoginForm />
          </div>
        </section>
      </div>

      {/* A locked look at the board: enough shape to feel it, no data in it. */}
      <section className="mt-16 border-t border-line pt-10 sm:mt-20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow eyebrow-ember">Inside the board</p>
          <span className="pill border-paper/25 text-paper/70">Locked</span>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-2xl border border-line bg-coal">
          <div
            aria-hidden="true"
            className="pointer-events-none grid select-none gap-4 p-4 opacity-45 blur-[5px] sm:grid-cols-2 sm:p-6"
          >
            {TEASER.map((teaser) => (
              <div key={teaser.company} className="card p-5">
                <div className="flex items-start gap-3">
                  <span className="monogram">{monogram(teaser.company)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] uppercase tracking-[0.22em] text-paper/90">
                      {teaser.company}
                    </p>
                    <p className="eyebrow mt-1.5">Closer role</p>
                  </div>
                </div>
                <p className="mt-5 font-display text-xl leading-tight">
                  {teaser.title}
                </p>
                <div className="mt-5 border-t border-line pt-4">
                  <p className="eyebrow">Commission</p>
                  <p className="mt-1.5 font-display text-xl tracking-tight text-ember">
                    {teaser.commission}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-ink via-ink/65 to-ink/25"
          />
          <div className="absolute inset-0 grid place-items-center px-6 py-10 text-center">
            <div>
              <p className="font-display text-2xl leading-snug sm:text-3xl">
                The board is behind the door.
              </p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-mute">
                Sign in with the account Coeso gave you to see live offers,
                commissions and who is hiring.
              </p>
              <Link
                href="/offers"
                className="mt-5 inline-block font-mono text-[10px] uppercase tracking-[0.25em] text-ember underline decoration-ember/40 underline-offset-4 hover:decoration-ember"
              >
                Unlock with your login ↑
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
