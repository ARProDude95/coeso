"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const ROLE_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "setter", label: "Setter" },
  { value: "closer", label: "Closer" },
  { value: "both", label: "Setter + Closer" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "Any status" },
];

export function OfferFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get("q") ?? "";

  const [search, setSearch] = useState(query);
  const roleType = searchParams.get("roleType") ?? "all";
  const status = searchParams.get("status") ?? "open";

  // Re-sync the input when the URL changes (back/forward, Clear).
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setSearch(query);
  }

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all" || value === "open") params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function onSearch(value: string, replace: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("q", value);
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    if (replace) router.refresh();
  }

  const hasFilters =
    !!searchParams.get("q") ||
    roleType !== "all" ||
    status !== "open";

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(search, true);
      }}
    >
      <div className="relative flex-1">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onBlur={() => onSearch(search, false)}
          placeholder="Search title, company or description…"
          aria-label="Search offers"
          className="input input-search"
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>

      <div className="flex gap-3">
        <select
          value={roleType}
          onChange={(event) => update("roleType", event.target.value)}
          aria-label="Filter by role type"
          className="select sm:w-44"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(event) => update("status", event.target.value)}
          aria-label="Filter by status"
          className="select sm:w-40"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSearch("");
            router.replace(pathname, { scroll: false });
          }}
        >
          Clear
        </button>
      )}
    </form>
  );
}
