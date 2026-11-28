"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough that a fast, prefetched route never flashes the bar. */
const DELAY_MS = 150;
/** Safety net: a navigation that never lands must not leave the bar up. */
const SAFETY_MS = 12_000;

function isTrackable(anchor: HTMLAnchorElement): boolean {
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname;
}

/**
 * The board reads D1 on every request, so a route change can take a second or
 * two. Without a segment loading file — which this runtime cannot reveal — the
 * old page just sits there looking inert, so a click now starts a hairline bar
 * at the top of the viewport until the new pathname arrives.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setVisible(false);
  }, []);

  // The route landed (or an error boundary swapped it): drop the bar.
  useEffect(() => {
    stop();
  }, [pathname, stop]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest("a") : null;
      if (!anchor || !isTrackable(anchor as HTMLAnchorElement)) return;

      stop();
      timers.current.push(window.setTimeout(() => setVisible(true), DELAY_MS));
      timers.current.push(
        window.setTimeout(() => setVisible(false), SAFETY_MS),
      );
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [stop]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-line/60"
    >
      <span className="nav-progress block h-full bg-ember" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
