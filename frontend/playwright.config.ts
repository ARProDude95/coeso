import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression config for the storybook-lite gallery and the mocked page
 * harness. Everything is tuned for deterministic screenshots:
 *  - a single browser (Chromium) and a pinned device scale factor,
 *  - a fixed TZ (page content includes dates),
 *  - animations and web fonts disabled.
 *
 * Baselines live in `frontend/e2e/visual.spec.ts-snapshots/` and are committed.
 * Regenerate them after an intentional design change with
 * `npm run test:visual:update`.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 30_000,

  expect: {
    toHaveScreenshot: {
      // Per-pixel colour sensitivity. Playwright's default (0.2) is far too
      // forgiving for design review: a gold→orange accent shift scores ~837 on
      // the YIQ scale, under the 0.2 cutoff, so it is reported as "identical".
      // 0.05 catches hue/saturation shifts while still ignoring PNG/AA noise.
      threshold: 0.05,
      // Allow a tiny fraction of pixels to drift (font AA, sub-pixel borders)
      // without letting a real change through.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'UTC',
    locale: 'en-US',
    // Fixed viewport so layout is identical on every machine/CI runner.
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Neutralize web-font metric drift between the CI runner and macOS/Windows.
        launchOptions: {
          args: ['--font-render-hinting=none', '--disable-lcd-text'],
        },
      },
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
