
### Offers Board — Batch 1 design pass ✅

- **Card hierarchy:** commission is now the hero figure on each board card
  (display face, ember, its own bordered band), with the company monogram as the
  logo stand-in and a "New this week" badge for offers under seven days old.
  Extracted into `components/offer-card.tsx` so the card is one definition.
- **Login gate:** a blurred, non-interactive teaser of the board sits under the
  sign-in panel with a gradient scrim and a "the board is behind the door"
  overlay. The teaser is illustrative markup only — no board data is read for a
  signed-out visitor.
- **Consistent rhythm:** one `.eyebrow` label style, one card padding scale
  (`p-5 sm:p-6`), one section spacing scale across board, detail and applications.
- **Keyboard focus:** a single `:focus-visible` ring (ember, 2px, 2px offset) in
  `globals.css` covers every link, button and field; mouse users see no ring.
- **Skeletons:** `app/offers/loading.tsx` and `app/offers/[id]/loading.tsx` mirror
  the real layouts (hero, sticky filter bar, card grid, apply aside) so the swap
  to content does not jump. Shimmer is disabled under reduced-motion.
- **Empty states:** one `EmptyState` component. The board distinguishes "board is
  quiet" (no offers at all) from "no matches", and the applications page now uses
  the same shape with a CTA.
- **Mobile filters:** the search + role pills sit in a sticky bar under the header
  below `sm`, with a horizontally scrollable, scrollbar-free pill row; on wider
  screens it returns to normal flow. Active role carries `aria-current="page"`.
- **Checks:** `tsc --noEmit` clean; OpenNext build clean; new CSS classes present
  in the built stylesheet (`.monogram`, `.skeleton`, `:focus-visible`,
  `top-[61px]`, `.card-link`, `.eyebrow`). Preview (6 cards): 6 monograms, 6
  commission heroes, 3 new-this-week badges, 1 featured, filter empty state
  renders. Production: login teaser + CSS 200; board renders its empty state
  because production has no offers yet. No browser/screenshot review was done.

### Offers Board — Batch 2 interactivity pass ✅

- **Instant board:** the server sends the open offers once and
  `components/board-browser.tsx` filters, sorts and chips them in the browser —
  no round trip per keystroke. Search covers title, company, description,
  requirements and pay type; charts are multi-select chips for role and for every
  pay structure actually present on the board.
- **Sorting:** newest, biggest commission (first number in the commission string,
  so "18%" and "$900" order sensibly), oldest, company A–Z. Logic lives in
  `lib/board-filter.ts` as a pure function.
- **Shortlist:** ★ on each card writes to `localStorage` under
  `coeso.shortlist.offers`; the "★ Shortlisted · n" chip filters to it and
  unstarring from inside the filter removes the row immediately.
- **Compare:** up to three offers; a fixed tray at the bottom holds the
  selection and "Compare" opens a side-by-side table (role, commission, pay,
  posted, open/remove). The selection is stored under `coeso.compare.offers` so
  opening an offer and coming back does not clear it.
- **Apply form:** inline validation per field (email shape, Discord, a little
  experience detail, whole hours 1–80, message cap) with `aria-invalid`,
  `aria-describedby` and a focus jump to the first invalid field on submit. A
  draft is written to `coeso.apply.draft.<offerId>` on every keystroke, restored
  on return with a "Picked up where you left off" note and "Start over", and
  cleared on successful submit. Validation and draft normalization live in
  `lib/apply-fields.ts`.
- **Checks:** `tsc --noEmit` clean; OpenNext build clean; 26 pure-logic checks
  passed under Bun (search/role/pay/shortlist filters, four sort orders, pay
  option derivation, validation rules, draft normalization). Local workerd:
  board renders 6 cards each with shortlist + compare controls, sort select and
  chips; apply API still answers 400 for a bad email, 201 for a valid
  application, 409 for a repeat. Both environments deployed: preview shows the
  controls on 6 cards, production renders the filter bar and empty state (no
  offers yet).
- **Not verified:** the browser-only behaviour itself (keystroke filtering,
  localStorage persistence across a closed tab, the compare tray and the draft
  restore) — no browser automation was run, per the standing HTTP-only rule.
