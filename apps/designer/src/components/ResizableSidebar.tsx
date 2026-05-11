import { useEffect, useRef, useState } from "react";

/**
 * A side panel with a draggable inner edge and a collapse toggle.
 *
 * Used for the designer's left (LayerTree + CardData) and right
 * (Inspector + Validation) panes. Dragging the inner edge resizes the
 * panel within `[minWidth, maxWidth]`; clicking the chevron collapses
 * it to a thin bar; double-clicking the drag handle also collapses.
 *
 * State (width + collapsed) persists per-`storageKey` to localStorage so
 * the user's layout survives reloads.
 *
 * Why pixel widths over CSS percentages: card design canvases get tight
 * around 1280px monitors. A user who's set the inspector to 280px wants
 * exactly 280px back, not "33% of whatever the window is now".
 */
export function ResizableSidebar({
  side,
  storageKey,
  defaultWidth = 280,
  minWidth = 200,
  maxWidth = 600,
  collapsedWidth = 28,
  collapsedLabel,
  children,
}: {
  /** Which edge the panel hugs — controls drag direction and chevron orientation. */
  side: "left" | "right";
  /** localStorage key prefix. Two entries are written: ".width" and ".collapsed". */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsedWidth?: number;
  /** Vertical text shown on the collapsed bar (e.g. "Layers"). Optional. */
  collapsedLabel?: string;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const saved = window.localStorage.getItem(`${storageKey}.width`);
    const n = saved ? Number.parseInt(saved, 10) : NaN;
    return Number.isFinite(n) ? clamp(n, minWidth, maxWidth) : defaultWidth;
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`${storageKey}.collapsed`) === "true";
  });

  // Persist state. Cheap to write; the delay is dominated by the browser
  // microtask queue, not actual disk IO, so no debounce needed for typical
  // drag rates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${storageKey}.width`, String(width));
  }, [storageKey, width]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${storageKey}.collapsed`, String(collapsed));
  }, [storageKey, collapsed]);

  // Latest width / clamps captured per-drag so the listener closures don't
  // see stale state during rapid pointer movement.
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startW: width };
    function onMove(ev: PointerEvent) {
      const ctx = dragRef.current;
      if (!ctx) return;
      // For a left panel, dragging right increases width; for a right
      // panel, dragging left increases width. Sign flip handles that.
      const dx = side === "left" ? ev.clientX - ctx.startX : ctx.startX - ev.clientX;
      setWidth(clamp(ctx.startW + dx, minWidth, maxWidth));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (collapsed) {
    return (
      <aside
        className={[
          "flex h-full flex-col flex-shrink-0 items-center gap-2 bg-ink-900 py-2",
          side === "left" ? "border-r border-ink-700" : "border-l border-ink-700",
        ].join(" ")}
        style={{ width: collapsedWidth }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand panel"
          className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          {side === "left" ? <ChevronRight /> : <ChevronLeft />}
        </button>
        {collapsedLabel && (
          <span
            className="select-none text-[10px] uppercase tracking-widest text-ink-500"
            style={{
              writingMode: "vertical-rl",
              transform: side === "left" ? undefined : "rotate(180deg)",
            }}
          >
            {collapsedLabel}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      className={[
        "relative h-full flex-shrink-0 bg-ink-900",
        side === "left" ? "border-r border-ink-700" : "border-l border-ink-700",
      ].join(" ")}
      style={{ width }}
    >
      {/* Collapse toggle. Positioned absolutely so panel internals don't
          have to leave room for it — and so users with narrow widths
          still see it. */}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        title="Collapse panel"
        className={[
          "absolute top-1 z-10 rounded p-1 text-ink-500 opacity-60 hover:bg-ink-800 hover:text-ink-100 hover:opacity-100",
          side === "left" ? "right-2" : "left-2",
        ].join(" ")}
      >
        {side === "left" ? <ChevronLeft /> : <ChevronRight />}
      </button>

      {/* Panel content fills the rest. Children are responsible for their
          own scroll containers. */}
      <div className="h-full">{children}</div>

      {/* Drag handle hugs the inner edge. 6px wide so it's easy to grab
          without being visually obtrusive. Hover lights up slightly so
          discoverability is decent without a permanent visible bar. */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => setCollapsed(true)}
        title="Drag to resize, double-click to collapse"
        className={[
          "absolute top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent-500/40",
          side === "left" ? "right-0 -mr-0.5" : "left-0 -ml-0.5",
        ].join(" ")}
      />
    </aside>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function ChevronLeft() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 4 L6 8 L10 12" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 4 L10 8 L6 12" />
    </svg>
  );
}
