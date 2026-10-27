import { useState } from 'react';
import Modal from '../components/Modal';
import { StorySection } from './scaffold';

/**
 * Modal story: the real <Modal> component over a dimmed panel so the backdrop,
 * card, header and action row are captured together.
 *
 * The app's `<Modal>` portals to document.body (so a transformed page section
 * can never trap its fixed backdrop behind the page). In the gallery we hand it
 * this story box as its portal target instead: the backdrop is then a
 * descendant of `.story` again and gallery.css can re-anchor it to this box
 * for the element screenshot, exactly as before.
 */
export function ModalStory() {
  // State (not useRef): the ref only populates after the first commit, and
  // Modal's portal target is chosen at render time — so gate on state to
  // render the dialog only once the box exists.
  const [storyBox, setStoryBox] = useState<HTMLDivElement | null>(null);

  return (
    <StorySection id="modal" title="Modal">
      {/* A static stand-in for page content behind the backdrop. The fixed
          height gives the dialog room to render fully inside the story box. */}
      <div
        ref={setStoryBox}
        style={{
          height: '340px',
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-overlay)',
        }}
      >
        <div style={{ padding: '1rem' }}>
          <div className="muted">Underlying page content…</div>
        </div>
        {storyBox && (
          <Modal
            title="Place rep on offer"
            onClose={() => {}}
            container={storyBox}
          >
            <div className="field">
              <label htmlFor="v-modal-offer">Offer</label>
              <select id="v-modal-offer" defaultValue="77">
                <option value="77">Enterprise AE — 1/2 seats filled</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-modal-note">Note (optional)</label>
              <input id="v-modal-note" placeholder="Why this rep is a fit" />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn">Cancel</button>
              <button type="button" className="btn btn-primary">Place rep</button>
            </div>
          </Modal>
        )}
      </div>
    </StorySection>
  );
}
