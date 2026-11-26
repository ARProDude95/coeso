import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authConfigured, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DISCORD_HANDLE = "a1rymn";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/admin" : "/offers");

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <section>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
            Coeso · Offers Board
          </p>
          <h1 className="mt-6 max-w-lg font-display text-5xl leading-[0.95] sm:text-6xl">
            Members <span className="italic text-ember">only.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-mute">
            The offers board is private. Every account is created by Coeso’s
            Owner and handed out personally — nobody can sign up from this page.
          </p>

          <div className="mt-10 space-y-4">
            <div className="card p-5">
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

        <section className="lg:pt-16">
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
    </main>
  );
}
