import { ReactNode } from 'react';

/**
 * Shared scaffolding for the visual-regression gallery (storybook-lite).
 *
 * Everything here is deliberately static and deterministic: no clocks, no
 * randomness, no animation. That is what lets CI screenshot each section and
 * byte-compare it against a committed baseline.
 */

/** A titled block wrapping one story. Rendered as a labelled <section> so the
 *  Playwright spec can screenshot it by name via its data-story attribute. */
export function StorySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="story" data-story={id} aria-label={title}>
      <h2 className="story-title">{title}</h2>
      <div className="story-body">{children}</div>
    </section>
  );
}
