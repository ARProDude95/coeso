import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { CoesoLogo } from "@/components/coeso-logo";
import { getAuthContext } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);

  // Already signed in? Straight to the board.
  const ctx = await getAuthContext();
  if (ctx) redirect(target);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="panel w-full max-w-md p-8">
        <div className="text-center">
          <CoesoLogo className="mx-auto mb-5 h-11 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
            Coeso Offers Board
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Sign in to browse live offers and track your applications.
          </p>
        </div>

        <AuthForm next={target} />

        <p className="mt-6 text-center text-xs leading-5 text-zinc-500">
          The first account created on a new board becomes its admin. Admins
          publish offers, review applicants and leave private notes.
        </p>
      </div>
    </div>
  );
}
