"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string> {
  /** Accessible name for the control, e.g. "Sort offers". */
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Applied to the trigger so callers can size it for their layout. */
  className?: string;
  /** Compact trigger for dense places like a table cell. */
  bare?: boolean;
  disabled?: boolean;
}

/**
 * A listbox instead of <select>: the native popup is drawn by the operating
 * system, so a dark board gets a white menu with a blue highlight that ignores
 * every colour on the page. This renders the menu in the board's own palette,
 * and keeps listbox keyboard behaviour (arrows, Home/End, Enter, Escape) and
 * the aria roles a native select would have provided.
 */
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
  bare = false,
  disabled = false,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const id = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = options[selectedIndex] ?? options[0];

  // Keep the highlighted row in view; focus follows the panel, not the rows, so
  // Tab leaves the menu instead of landing inside it.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening always starts on the current choice, as a native select does.
  function openMenu() {
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(options.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // Close, then let Tab continue from the trigger rather than a row that
        // is about to unmount.
        event.preventDefault();
        close();
        break;
    }
  }

  return (
    <div ref={wrapRef} className="relative h-full">
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
          }
        }}
        className={
          bare
            ? "inline-flex items-center gap-2 rounded-md border border-line bg-coal px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-paper disabled:opacity-50"
            : `field flex h-full items-center justify-between gap-3 pr-2.5 text-left whitespace-nowrap ${className}`
        }
      >
        <span>{current?.label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-3 w-3 shrink-0 transition-transform ${
            open ? "rotate-180 text-ember" : "text-mute"
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open ? (
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-trigger`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={`absolute right-0 z-30 mt-2 overflow-hidden rounded-xl border border-line bg-[#0b0d10] p-1 shadow-[0_20px_45px_-15px_rgba(0,0,0,0.95)] outline-none ${
            bare ? "w-44" : "w-60"
          }`}
        >
          {options.map((option, index) => {
            const selected = index === selectedIndex;
            const highlighted = index === active;
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  highlighted ? "bg-[#191d23] text-paper" : "text-mute"
                } ${selected ? "text-paper" : ""}`}
              >
                <span>{option.label}</span>
                {selected ? (
                  <span aria-hidden="true" className="text-ember">
                    ✓
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
