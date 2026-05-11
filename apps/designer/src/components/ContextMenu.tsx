import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic context-menu primitive.
 *
 * The hook returns:
 *   • `onContextMenu`  — bind to any element to open the menu at the
 *     mouse position when the user right-clicks (or long-presses on
 *     touch).
 *   • `open(x, y)`     — programmatic open (e.g. from a "more" icon
 *     button — the menu anchors at the icon's screen coords).
 *   • `element`        — render this somewhere in the tree (typically
 *     at the bottom of the consuming component) so the menu can paint
 *     over everything.
 *
 * Items are an array — separators are simple `{ separator: true }`
 * entries that render as a thin divider line. `danger: true` colors
 * the row red for "destructive" actions (delete, etc.). `disabled`
 * grays it out and ignores clicks.
 *
 * The menu auto-dismisses on:
 *   • Outside click (mousedown anywhere outside the menu element)
 *   • Escape key
 *   • Selecting a non-disabled item
 *   • Window blur (focus left the page)
 *
 * Positioning: opens at the requested coords, then nudges left/up
 * if it would otherwise clip the viewport. We measure after mount
 * so the very first paint can be off-screen — we then snap to the
 * corrected position on the next frame.
 */

export interface ContextMenuItem {
  label?: string;
  onSelect?: () => void;
  /** Show a horizontal divider instead of an item. */
  separator?: boolean;
  /** Disable interaction; row is shown grayed out. */
  disabled?: boolean;
  /** Render in destructive (red) styling. */
  danger?: boolean;
  /** Optional leading icon (small JSX element). */
  icon?: React.ReactNode;
  /** Optional trailing keyboard hint (e.g. "⌘D"). */
  shortcut?: string;
  /** Optional submenu — promoted to a flyout when present. */
  submenu?: ContextMenuItem[];
}

export interface UseContextMenu {
  /** Bind to any element's `onContextMenu` to open at the mouse. */
  onContextMenu: (e: React.MouseEvent) => void;
  /** Programmatically open at viewport coordinates. */
  open: (x: number, y: number) => void;
  /** Currently open? */
  isOpen: boolean;
  /** Render this somewhere in the tree. */
  element: React.ReactNode;
}

export function useContextMenu(
  itemsOrFactory: ContextMenuItem[] | (() => ContextMenuItem[]),
): UseContextMenu {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [items, setItems] = useState<ContextMenuItem[]>([]);

  const open = useCallback(
    (x: number, y: number) => {
      const next =
        typeof itemsOrFactory === "function" ? itemsOrFactory() : itemsOrFactory;
      setItems(next);
      setPos({ x, y });
    },
    [itemsOrFactory],
  );

  const close = useCallback(() => setPos(null), []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY);
    },
    [open],
  );

  return {
    onContextMenu,
    open,
    isOpen: pos !== null,
    element:
      pos !== null ? (
        <ContextMenu items={items} x={pos.x} y={pos.y} onClose={close} />
      ) : null,
  };
}

/**
 * The actual menu component. Most consumers should reach for
 * `useContextMenu` rather than rendering this directly — but it's
 * exported in case you want to drive it from somewhere unusual
 * (e.g. an animated press-and-hold gesture on touch).
 */
export function ContextMenu({
  items,
  x,
  y,
  onClose,
}: {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [adjusted, setAdjusted] = useState({ x, y });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Adjust position after mount so the menu doesn't clip the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 4) {
      nx = Math.max(4, window.innerWidth - r.width - 4);
    }
    if (y + r.height > window.innerHeight - 4) {
      ny = Math.max(4, window.innerHeight - r.height - 4);
    }
    setAdjusted({ x: nx, y: ny });
  }, [x, y]);

  // Outside-click + escape dismiss.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onBlur() {
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  function selectIndex(i: number) {
    const it = items[i];
    if (!it || it.separator || it.disabled) return;
    onClose();
    // Defer to next tick so the close animation (if any) doesn't race
    // with state updates triggered by the action.
    setTimeout(() => it.onSelect?.(), 0);
  }

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => {
        // Right-clicking inside the menu shouldn't open another menu;
        // swallow to keep the existing one stable.
        e.preventDefault();
      }}
      className="fixed z-[100] min-w-[180px] overflow-hidden rounded-md border border-ink-700 bg-ink-900 py-1 text-sm text-ink-100 shadow-xl"
      style={{ left: adjusted.x, top: adjusted.y }}
    >
      {items.map((it, i) => {
        if (it.separator) {
          return (
            <div
              key={`sep-${i}`}
              role="separator"
              className="my-1 h-px bg-ink-800"
            />
          );
        }
        const disabled = Boolean(it.disabled);
        const danger = Boolean(it.danger);
        return (
          <button
            key={`item-${i}`}
            role="menuitem"
            type="button"
            disabled={disabled}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
            className={[
              "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs",
              disabled
                ? "cursor-not-allowed text-ink-600"
                : danger
                ? hoverIndex === i
                  ? "bg-danger-500/15 text-danger-300"
                  : "text-danger-400"
                : hoverIndex === i
                ? "bg-accent-500/15 text-accent-200"
                : "text-ink-200 hover:bg-ink-800",
            ].join(" ")}
          >
            <span className="flex items-center gap-2">
              {it.icon && <span className="text-ink-500">{it.icon}</span>}
              <span>{it.label}</span>
            </span>
            {it.shortcut && (
              <span className="ml-2 font-mono text-[10px] text-ink-500">
                {it.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
