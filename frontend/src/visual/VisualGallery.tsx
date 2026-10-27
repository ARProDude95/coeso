import { ColorTokens, TypeRamp } from './TokenStories';
import {
  Buttons,
  Pills,
  Stats,
  Forms,
  Cards,
  BoardCard,
  EmptyStates,
  SettingsRows,
} from './ComponentStories';
import { ModalStory } from './ModalStory';
import './gallery.css';

/**
 * The storybook-lite gallery: every design token and component primitive, laid
 * out on one page. Each block carries a stable `data-story="<id>"` attribute
 * (from StorySection) that the Playwright visual spec uses to screenshot it in
 * isolation. Static markup only — no data fetching, no live state — so the
 * rendered pixels are deterministic across runs.
 *
 * Routed at `/__visual` (see App.tsx) purely as a design/QA surface; it is not
 * linked from the app's nav.
 */
export default function VisualGallery() {
  return (
    <main className="visual-page" data-testid="visual-gallery">
      <header className="page-header">
        <div>
          <h1>Design gallery</h1>
          <p className="page-sub">
            Storybook-lite surface for visual regression. Each section below is
            screenshotted in CI and compared to a committed baseline.
          </p>
        </div>
      </header>

      <ColorTokens />
      <TypeRamp />
      <Buttons />
      <Pills />
      <Stats />
      <Forms />
      <Cards />
      <BoardCard />
      <SettingsRows />
      <EmptyStates />
      <ModalStory />
    </main>
  );
}
