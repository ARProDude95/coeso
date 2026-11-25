import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";

/**
 * Structural gate for the whole /admin segment: admins and `partner` members
 * pass. Every page also calls its own guard (`requireAdmin` for admin-only
 * pages, `requireStaff` + ownership checks for partner-shared ones) before
 * touching data — this layout makes sure a page added later can't be reached
 * without at least staff access.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={<div className="skeleton h-96 w-full" aria-busy="true" />}
    >
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <>{children}</>;
}
