"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { OfferCard } from "@/components/offer-card";
import { SelectMenu } from "@/components/select-menu";
import {
  SORT_LABELS,
  filterAndSortOffers,
  payOptions,
  type Sort,
} from "@/lib/board-filter";
import { ROLE_LABELS, formatPosted } from "@/lib/offer-format";
import type { Offer } from "@/lib/store";

const SHORTLIST_KEY = "coeso.shortlist.offers";
const COMPARE_KEY = "coeso.compare.offers";
const COMPARE_LIMIT = 3;

type RoleFilter = Offer["role_type"];

function readIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Private mode or a full quota: the board still works, it just forgets.
  }
}

export function BoardBrowser({
  offers,
  appliedOfferIds = [],
}: {
  offers: Offer[];
  /** Offers this member already applied to, so cards can say so. */
  appliedOfferIds?: string[];
}) {
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<RoleFilter[]>([]);
  const [pays, setPays] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("newest");
  const [shortlistOnly, setShortlistOnly] = useState(false);

  // Persisted across visits and tabs.
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [showCompare, setShowCompare] = useState(false);
  const compareRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setShortlist(readIds(SHORTLIST_KEY));
    setCompare(readIds(COMPARE_KEY));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!showCompare) return;
    compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showCompare]);

  const pays_ = useMemo(() => payOptions(offers), [offers]);

  const filtered = useMemo(
    () =>
      filterAndSortOffers(offers, {
        q,
        roles,
        pays,
        sort,
        shortlistOnly,
        shortlist,
      }),
    [offers, q, roles, pays, sort, shortlistOnly, shortlist],
  );

  const compareOffers = useMemo(
    () =>
      compare
        .map((id) => offers.find((offer) => offer.id === id))
        .filter((offer): offer is Offer => Boolean(offer)),
    [compare, offers],
  );

  const filtering =
    q.trim() !== "" ||
    roles.length > 0 ||
    pays.length > 0 ||
    shortlistOnly ||
    sort !== "newest";

  function toggleShortlist(id: string) {
    const next = shortlist.includes(id)
      ? shortlist.filter((value) => value !== id)
      : [...shortlist, id];
    setShortlist(next);
    writeIds(SHORTLIST_KEY, next);
  }

  function toggleCompare(id: string) {
    const next = compare.includes(id)
      ? compare.filter((value) => value !== id)
      : compare.length >= COMPARE_LIMIT
        ? compare
        : [...compare, id];
    setCompare(next);
    writeIds(COMPARE_KEY, next);
  }

  function toggleRole(role: RoleFilter) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((value) => value !== role)
        : [...current, role],
    );
  }

  function togglePay(pay: string) {
    setPays((current) =>
      current.includes(pay)
        ? current.filter((value) => value !== pay)
        : [...current, pay],
    );
  }

  function clearFilters() {
    setQ("");
    setRoles([]);
    setPays([]);
    setShortlistOnly(false);
    setSort("newest");
  }

  function removeFromCompare(id: string) {
    const next = compare.filter((value) => value !== id);
    setCompare(next);
    writeIds(COMPARE_KEY, next);
  }

  const rows: Array<{ label: string; value: (offer: Offer) => ReactNode }> = [
    { label: "Role", value: (offer) => ROLE_LABELS[offer.role_type] },
    {
      label: "Commission",
      value: (offer) => (
        <span className="font-display text-lg leading-tight text-ember">
          {offer.commission}
        </span>
      ),
    },
    { label: "Pay structure", value: (offer) => offer.pay_type },
    { label: "Posted", value: (offer) => formatPosted(offer.created_at) },
  ];

  return (
    <>
      {/* Filters stick under the header on a phone, then settle into the page. */}
      <div className="sticky top-[61px] z-10 -mx-5 border-b border-line bg-ink/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-10 sm:backdrop-blur-none">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            type="search"
            placeholder="Search title, company, keywords…"
            aria-label="Search offers"
            className="field flex-1"
          />
          <div className="shrink-0">
            <SelectMenu
              label="Sort offers"
              value={sort}
              onChange={setSort}
              options={(Object.keys(SORT_LABELS) as Sort[]).map((key) => ({
                value: key,
                label: SORT_LABELS[key],
              }))}
              className="w-auto"
            />
          </div>
        </div>

        <div className="no-scrollbar -mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:mt-4 sm:flex-wrap sm:overflow-visible">
          <button
            type="button"
            onClick={() => setShortlistOnly((value) => !value)}
            aria-pressed={shortlistOnly}
            disabled={hydrated && shortlist.length === 0}
            className={`pill shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${
              shortlistOnly ? "pill-active" : ""
            }`}
          >
            ★ Shortlisted · {hydrated ? shortlist.length : 0}
          </button>

          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />

          <button
            type="button"
            onClick={() => setRoles([])}
            aria-pressed={roles.length === 0}
            className={`pill shrink-0 ${roles.length === 0 ? "pill-active" : ""}`}
          >
            All roles
          </button>
          {(Object.keys(ROLE_LABELS) as RoleFilter[]).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              aria-pressed={roles.includes(role)}
              className={`pill shrink-0 ${roles.includes(role) ? "pill-active" : ""}`}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}

          {pays_.length > 1 ? (
            <>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
              {pays_.map((pay) => (
                <button
                  key={pay}
                  type="button"
                  onClick={() => togglePay(pay)}
                  aria-pressed={pays.includes(pay)}
                  className={`pill shrink-0 ${
                    pays.includes(pay) ? "border-paper/60 text-paper" : ""
                  }`}
                >
                  {pay}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <section
        className={`py-8 sm:py-10 ${compare.length > 0 ? "pb-32 sm:pb-10" : ""}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "offer" : "offers"}
            {q.trim() ? ` matching “${q.trim()}”` : ""}
            {shortlistOnly ? " · shortlisted" : ""}
          </p>
          {filtering ? (
            <button
              type="button"
              onClick={clearFilters}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute underline decoration-line underline-offset-4 hover:text-paper"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {showCompare && compareOffers.length >= 2 ? (
          <section
            ref={compareRef}
            aria-labelledby="compare-heading"
            className="card mt-4 overflow-hidden scroll-mt-32"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <p id="compare-heading" className="eyebrow eyebrow-ember">
                  Comparing {compareOffers.length} offers
                </p>
                <p className="mt-1 text-xs text-mute">
                  The numbers, side by side.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompare(false)}
                className="eyebrow hover:text-paper"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="w-28 px-4 py-3 sm:px-5" />
                    {compareOffers.map((offer) => (
                      <th
                        key={offer.id}
                        scope="col"
                        className="px-4 py-3 align-top font-normal"
                      >
                        <Link
                          href={`/offers/${offer.id}`}
                          className="font-display text-base leading-tight hover:text-ember"
                        >
                          {offer.title}
                        </Link>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-mute">
                          {offer.company}
                        </p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-b border-line/60">
                      <th
                        scope="row"
                        className="px-4 py-3 align-top font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-mute sm:px-5"
                      >
                        {row.label}
                      </th>
                      {compareOffers.map((offer) => (
                        <td key={offer.id} className="px-4 py-3 align-top">
                          {row.value(offer)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="px-4 py-3 sm:px-5" />
                    {compareOffers.map((offer) => (
                      <td key={offer.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/offers/${offer.id}`}
                            className="btn px-3 py-1.5 text-xs"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            onClick={() => removeFromCompare(offer.id)}
                            className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute hover:text-paper"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {offers.length === 0 ? (
          <EmptyState
            eyebrow="Board is quiet"
            title="No offers are live right now."
            body="Coeso’s Owner posts every offer here personally. When something opens, it lands on this board — check back soon."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            eyebrow="No matches"
            title={
              shortlistOnly
                ? "Nothing shortlisted matches those filters."
                : "Nothing on the board for that search."
            }
            body={
              shortlistOnly
                ? "Star an offer on the board to keep it here, then come back to compare."
                : "Try a different keyword, or loosen the role and pay filters."
            }
            action={{ label: "Clear filters", onClick: clearFilters }}
          />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {filtered.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                applied={appliedOfferIds.includes(offer.id)}
                shortlisted={shortlist.includes(offer.id)}
                compared={compare.includes(offer.id)}
                compareDisabled={compare.length >= COMPARE_LIMIT}
                onToggleShortlist={toggleShortlist}
                onToggleCompare={toggleCompare}
              />
            ))}
          </div>
        )}
      </section>

      {compare.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-coal/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
            <p className="eyebrow shrink-0">
              Compare · {compareOffers.length}/{COMPARE_LIMIT}
            </p>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {compareOffers.map((offer) => (
                <span
                  key={offer.id}
                  className="pill max-w-[14rem] border-paper/25 py-1 text-paper/80"
                >
                  <span className="truncate">{offer.company}</span>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(offer.id)}
                    aria-label={`Remove ${offer.title} from comparison`}
                    className="ml-1 text-mute hover:text-paper"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompare([]);
                  writeIds(COMPARE_KEY, []);
                  setShowCompare(false);
                }}
                className="btn px-3 py-1.5 text-xs"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowCompare((value) => !value)}
                disabled={compareOffers.length < 2}
                className="btn btn-primary px-3 py-1.5 text-xs"
              >
                {showCompare ? "Hide comparison" : "Compare"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
