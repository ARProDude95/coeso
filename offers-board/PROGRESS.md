
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
