import Link from "next/link";

type Tab =
  | "dashboard"
  | "new"
  | "analytics"
  | "members"
  | "reports"
  | "settings";

const TABS: Array<{ id: Tab; href: string; label: string; adminOnly: boolean }> =
  [
    { id: "dashboard", href: "/admin", label: "Dashboard", adminOnly: false },
    {
      id: "new",
      href: "/admin/offers/new",
      label: "New offer",
      adminOnly: false,
    },
    {
      id: "analytics",
      href: "/admin/analytics",
      label: "Analytics",
      adminOnly: false,
    },
    { id: "members", href: "/admin/members", label: "Members", adminOnly: true },
    { id: "reports", href: "/admin/reports", label: "Reports", adminOnly: true },
    {
      id: "settings",
      href: "/admin/settings",
      label: "Settings",
      adminOnly: true,
    },
  ];

/**
 * Staff navigation. `partner` hides the admin-only tabs (members, reports,
 * settings) instead of linking a partner to a page that will redirect them.
 */
export function AdminNav({
  current,
  partner = false,
}: {
  current?: Tab;
  partner?: boolean;
}) {
  return (
    <nav className="flex gap-1 border-b border-zinc-800">
      {TABS.filter((tab) => !partner || !tab.adminOnly).map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={
            tab.id === current
              ? "-mb-px border-b-2 border-indigo-500 px-4 py-2.5 text-sm font-medium text-white"
              : "-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-200"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function AdminHeader({
  title,
  description,
  action,
  eyebrow = "Admin",
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
          {title}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>
      {action}
    </div>
  );
}
