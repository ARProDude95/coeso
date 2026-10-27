import { test, expect, Page } from '@playwright/test';

/**
 * Visual-regression spec.
 *
 * Two capture groups:
 *  1. Gallery — every `[data-story]` section on /__visual (tokens + components).
 *  2. Pages   — each real workspace route, rendered by the visual harness over
 *               deterministic mock data (see src/visual/page-harness.tsx).
 *
 * Baselines are committed under e2e/visual.spec.ts-snapshots/. After an
 * intentional design change, regenerate with `npm run test:visual:update`.
 */

/**
 * Settle the page into a deterministic painted frame before any screenshot.
 *
 * Baselines captured mid-animation are worthless: an entry fade that is 20%
 * complete on one run and 100% on the next makes every comparison a false
 * positive or negative. So we (a) kill CSS animations/transitions, (b) wait
 * for web fonts, (c) wait for network idle, and (d) wait two animation frames
 * so layout and paint have both committed.
 */
async function stabilize(page: Page) {
  await page.waitForLoadState('networkidle');

  // Jump every animation/transition to its end state, then make sure the
  // browser has actually re-painted with the neutralized styles.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });

  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe('gallery', () => {
  test('renders every story section', async ({ page }) => {
    await page.goto('/__visual');

    const sections = page.locator('[data-story]');
    await expect(sections.first()).toBeVisible();

    // Guard against a silently-empty gallery (e.g. a broken import).
    const count = await sections.count();
    expect(count, 'gallery must render at least one story section').toBeGreaterThan(0);

    await stabilize(page);

    for (let i = 0; i < count; i += 1) {
      const section = sections.nth(i);
      const id = await section.getAttribute('data-story');
      expect(id, 'every story section needs a data-story id').toBeTruthy();
      // Screenshot the section element itself, tightly cropped.
      await expect(section).toHaveScreenshot(`gallery-${id}.png`);
    }
  });
});

test.describe('pages', () => {
  // The mocked page harness lives on its own Vite entry (visual.html) and
  // rewrites the URL to the target route on boot.
  const PAGES = [
    'roster',
    'offers',
    'board',
    'reports',
    'performance',
    'office-hours',
    'intros',
    'pods',
    'engagement',
    'settings',
    'pricing',
  ];

  for (const slug of PAGES) {
    test(`page: ${slug}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(`/visual.html?page=${slug}`);

      // Wait until the real app shell has mounted and painted content.
      const app = page.locator('.app-shell, .page, .empty-state').first();
      await expect(app).toBeVisible({ timeout: 15_000 });

      await stabilize(page);

      // A crashed page would otherwise be screenshotted as a blank frame.
      expect(errors, `page ${slug} threw during render`).toEqual([]);

      await expect(page).toHaveScreenshot(`page-${slug}.png`, { fullPage: true });
    });
  }
});
