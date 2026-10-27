# Visual regression

Screenshot-compares the design so a styling change fails CI instead of slipping
through review. Two capture groups run in Chromium via Playwright:

- **Gallery** — `/__visual`, a storybook-lite surface of the design system:
  color tokens, type ramp, buttons, pills, stats, forms, cards, board column,
  settings rows, empty states and the modal. Source:
  [`src/visual/`](../src/visual/).
- **Pages** — the real workspace routes (roster, offers, board, reports, …)
  rendered by [`src/visual/page-harness.tsx`](../src/visual/page-harness.tsx)
  against deterministic fixtures, so pages screenshot without a backend.

## Commands

```bash
npm run test:visual          # compare against committed baselines (CI mode)
npm run test:visual:update   # regenerate baselines after an intentional change
npm run test:visual:report   # open the HTML report with diff images
```

Open the gallery in a browser while designing:

```bash
npm run dev    # then visit http://localhost:5173/__visual
```

## Baselines

Baselines live in [`visual.spec.ts-snapshots/`](./visual.spec.ts-snapshots/) and
are committed. Each file is suffixed with the OS (e.g. `-win32.png`) because
font rendering differs per platform — **regenerate them from the same OS that
runs CI** (`.github/workflows/visual.yml` pins `windows-latest`).

After an intentional design change: run `npm run test:visual:update`, eyeball
the updated PNGs, and commit them with the change. On an unexpected failure the
workflow uploads `visual-regression-diffs` with the expected/actual/diff images.

## Adding a story or page

- New component/token story: wrap it in `StorySection` with a unique `id` inside
  [`src/visual/VisualGallery.tsx`](../src/visual/VisualGallery.tsx) — the spec
  picks up every `[data-story]` element automatically.
- New page shot: add its slug to `PAGE_TARGETS` in
  [`src/visual/page-harness.tsx`](../src/visual/page-harness.tsx) and to the
  `PAGES` list in [`visual.spec.ts`](./visual.spec.ts), plus any API fixtures to
  [`src/visual/mockApi.ts`](../src/visual/mockApi.ts).
