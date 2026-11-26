import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * Server-side gate for the whole board. Members are view-only; the admin
 * dashboard lives outside this layout at /admin.
 */
export default async function OffersLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");

  return <>{children}</>;
}
