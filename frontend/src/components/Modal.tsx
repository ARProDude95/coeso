import { useEffect } from 'react';
import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Generic modal: backdrop click or Escape closes; content is children.
 *
 * Rendered through a portal into document.body so it leaves the page's DOM
 * tree. That matters because page sections run transform-based entrance
 * animations (`rise`, fill-mode both — the transform stays applied as an
 * identity matrix after the animation ends), which makes the section a
 * containing block for `position: fixed` AND a stacking context: the
 * backdrop's z-index would be trapped below the sticky topnav and later page
 * siblings, and the dialog painted *behind* the page. At document.body the
 * fixed backdrop anchors to the viewport and z-index 50 wins as intended.
 *
 * `container` overrides the portal target — the visual gallery passes its
 * story box so gallery.css can re-anchor the backdrop for element screenshots.
 */
export default function Modal({
  title,
  onClose,
  children,
  container,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Portal target. Defaults to document.body. */
  container?: HTMLElement | null;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    container ?? document.body,
  );
}
