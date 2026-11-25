"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  offerId: string | null;
  read: boolean;
  createdAt: string;
}

interface Props {
  initial: NotificationView[];
}

export function NotificationsList({ initial }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);

  function markOne(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function markAll() {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    router.refresh();
  }

  const unread = items.filter((item) => !item.read).length;

  if (items.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">
          Nothing yet. Alerts from your saved searches land here.
        </p>
        <Link href="/saved-searches" className="btn btn-secondary mt-4 inline-flex">
          Create a saved search
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {unread} unread{unread > 0 ? ` of ${items.length}` : ""}
        </p>
        {unread > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => void markAll()}>
            Mark all read
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const inner = (
            <>
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  item.read ? "bg-zinc-700" : "bg-indigo-500"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-100">
                  {item.title}
                </span>
                {item.body && (
                  <span className="block truncate text-xs text-zinc-500">
                    {item.body}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-zinc-500">
                {new Date(item.createdAt).toLocaleDateString("en-US")}
              </span>
            </>
          );

          return (
            <li key={item.id}>
              {item.offerId ? (
                <Link
                  href={`/offers/${item.offerId}`}
                  onClick={() => markOne(item.id)}
                  className={`panel flex items-start gap-3 p-4 transition-colors hover:border-zinc-700 ${
                    item.read ? "opacity-70" : ""
                  }`}
                >
                  {inner}
                </Link>
              ) : (
                <div className={`panel flex items-start gap-3 p-4 ${item.read ? "opacity-70" : ""}`}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
