import { useMemo, useState } from "react";
import { useDesigner } from "@/store/designerStore";
import type { Layer } from "@/types";
import { groupChildren } from "@/lib/groups";
import { useContextMenu } from "@/components/ContextMenu";

/**
 * Layer tree (left panel).
 *
 * Spec sec 19.4 lists rename / reorder / drag / group / duplicate / hide / lock
 * / pin / collapse / search / filter / context menu / multi-select.
 *
 * v0 covers: select, rename (double-click), reorder (up/down buttons), hide,
 * lock, duplicate, delete. Drag-reorder, multi-select, grouping, and search
 * land in v1.
 *
 * Render order note: the canvas renders layer index 0 first (bottom-most). The
 * layer tree is the visual inverse — we show the *top-most* layer at the top
 * of the list because that matches every other DCC tool the user has seen.
 */
export function LayerTree() {
  const layers = useDesigner((s) => s.template.layers);
  const selectedIds = useDesigner((s) => s.selectedLayerIds);
  const selectLayer = useDesigner((s) => s.selectLayer);
  const reorderLayer = useDesigner((s) => s.reorderLayer);
  const removeLayer = useDesigner((s) => s.removeLayer);
  const duplicateLayer = useDesigner((s) => s.duplicateLayer);
  const toggleVisibility = useDesigner((s) => s.toggleVisibility);
  const toggleLock = useDesigner((s) => s.toggleLock);
  const renameLayer = useDesigner((s) => s.renameLayer);
  const updateLayer = useDesigner((s) => s.updateLayer);
  const setLayerParent = useDesigner((s) => s.setLayerParent);
  const groupSelectedLayers = useDesigner((s) => s.groupSelectedLayers);
  const ungroupLayer = useDesigner((s) => s.ungroupLayer);
  const commit = useDesigner((s) => s.commit);

  // Build parent → children map. Top-level entries live under "__root__".
  // The tree is rendered top-of-canvas → bottom-of-canvas (reverse of
  // array order) per child list — matching every other DCC tool.
  const childMap = useMemo(() => groupChildren(layers), [layers]);
  const selectedSet = new Set(selectedIds);

  // Index helper — every row needs to know its underlying array index for
  // reorder operations. Cheap to recompute on each render of a small list.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    layers.forEach((l, i) => m.set(l.id, i));
    return m;
  }, [layers]);

  // Pick a single selected group as the "drop into here" target for new
  // layers — enables the toolbar "Add layer" to place items inside the
  // active group automatically. Used here only for the "Group selected"
  // and "Ungroup" buttons.
  const selectedGroup = selectedIds.length === 1
    ? layers.find((l) => l.id === selectedIds[0] && l.type === "group")
    : null;

  function renderChildren(parentId: string): React.ReactNode {
    const kids = childMap.get(parentId) ?? [];
    // Display top-most first (largest array index appears at top).
    const display = [...kids].reverse();
    return display.map((layer) => {
      const index = indexById.get(layer.id) ?? 0;
      return (
        <LayerRow
          key={layer.id}
          layer={layer}
          index={index}
          total={layers.length}
          selected={selectedSet.has(layer.id)}
          onSelect={(e) =>
            selectLayer(layer.id, e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace")
          }
          onMoveTo={(toIndex) => reorderLayer(layer.id, toIndex)}
          onRename={(name) => renameLayer(layer.id, name)}
          onMoveUp={() => reorderLayer(layer.id, index + 1)}
          onMoveDown={() => reorderLayer(layer.id, index - 1)}
          onToggleVisible={() => toggleVisibility(layer.id)}
          onToggleLock={() => toggleLock(layer.id)}
          onDuplicate={() => duplicateLayer(layer.id)}
          onDelete={() => removeLayer(layer.id)}
          onToggleCollapsed={
            layer.type === "group"
              ? () => {
                  updateLayer(layer.id, { collapsed: !(layer.collapsed ?? false) } as Partial<Layer>);
                  commit();
                }
              : undefined
          }
          onMoveToParent={(newParentId) => setLayerParent(layer.id, newParentId)}
        >
          {layer.type === "group" && !(layer.collapsed ?? false) && (
            <ul className="border-l border-ink-700 pl-2">
              {renderChildren(layer.id)}
            </ul>
          )}
        </LayerRow>
      );
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Layers"
        subtitle={
          selectedIds.length > 1
            ? `${selectedIds.length} selected of ${layers.length}`
            : `${layers.length} layer${layers.length === 1 ? "" : "s"}`
        }
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Group selected layers"
              disabled={selectedIds.length === 0}
              onClick={() => {
                groupSelectedLayers();
              }}
              className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-700 disabled:opacity-30"
            >
              Group
            </button>
            {selectedGroup && (
              <button
                type="button"
                title="Ungroup — move children up to this group's parent"
                onClick={() => ungroupLayer(selectedGroup.id)}
                className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-700"
              >
                Ungroup
              </button>
            )}
          </div>
        }
      />
      <ul
        className="flex-1 overflow-y-auto py-1"
        // Drop on the empty area below all layers → move target to root level.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-tcgstudio-layer-id")) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("application/x-tcgstudio-layer-id");
          if (id) setLayerParent(id, null);
        }}
      >
        {renderChildren("__root__")}
        {layers.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-ink-400">
            No layers yet. Use the “Add layer” menu in the toolbar.
          </li>
        )}
      </ul>
    </div>
  );
}

interface LayerRowProps {
  layer: Layer;
  index: number;
  total: number;
  selected: boolean;
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: (toIndex: number) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Provided only for group rows — toggles the collapsed/expanded state. */
  onToggleCollapsed?: () => void;
  /** Reparent this layer (used by drag-into-group). */
  onMoveToParent?: (parentId: string | null) => void;
  /** Children rendered nested under this row (group's contents). */
  children?: React.ReactNode;
}

function LayerRow({
  layer,
  index,
  total,
  selected,
  onSelect,
  onRename,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onToggleVisible,
  onToggleLock,
  onDuplicate,
  onDelete,
  onToggleCollapsed,
  onMoveToParent,
  children,
}: LayerRowProps) {
  // HTML5 drag-and-drop reorder. We carry the source layer index in
  // dataTransfer; the drop target reads it and dispatches `reorderLayer`.
  // Visual feedback: above/below/inside indicator depending on cursor Y
  // vs row third-bands. Group rows additionally accept "drop inside" in
  // the middle band — that reparents the dragged layer.
  const [dropPos, setDropPos] = useState<"above" | "below" | "inside" | null>(null);
  const isGroup = layer.type === "group";

  const ctx = useContextMenu(() => [
    {
      label: layer.visible !== false ? "Hide" : "Show",
      onSelect: onToggleVisible,
    },
    {
      label: layer.locked ? "Unlock" : "Lock",
      onSelect: onToggleLock,
    },
    {
      label: "Duplicate",
      onSelect: onDuplicate,
      shortcut: "⌘D",
    },
    { separator: true },
    {
      label: "Move up",
      onSelect: onMoveUp,
      disabled: index >= total - 1,
    },
    {
      label: "Move down",
      onSelect: onMoveDown,
      disabled: index <= 0,
    },
    ...(onMoveToParent
      ? [
          {
            label: "Remove from group",
            onSelect: () => onMoveToParent(null),
            disabled: !layer.parentId,
          },
        ]
      : []),
    { separator: true },
    {
      label: "Rename…",
      onSelect: () => {
        const next = window.prompt("Rename layer", layer.name);
        if (next != null && next.trim()) onRename(next.trim());
      },
      shortcut: "F2",
    },
    { separator: true },
    {
      label: "Delete",
      onSelect: onDelete,
      danger: true,
      shortcut: "Del",
    },
  ]);

  return (
    <li
      onClick={(e) =>
        onSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })
      }
      onContextMenu={ctx.onContextMenu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-tcgstudio-layer", String(index));
        // Also carry the layer id for the cross-tree reparent path —
        // index alone isn't enough when the drop target wants the id.
        e.dataTransfer.setData("application/x-tcgstudio-layer-id", layer.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (
          !e.dataTransfer.types.includes("application/x-tcgstudio-layer") &&
          !e.dataTransfer.types.includes("application/x-tcgstudio-layer-id")
        ) {
          return;
        }
        e.preventDefault();
        const rect = (e.currentTarget as HTMLLIElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (isGroup) {
          // Three bands for group rows: top third = above, bottom third =
          // below, middle = drop inside (reparent).
          const third = rect.height / 3;
          setDropPos(y < third ? "above" : y > rect.height - third ? "below" : "inside");
        } else {
          setDropPos(y < rect.height / 2 ? "above" : "below");
        }
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData("application/x-tcgstudio-layer");
        const id = e.dataTransfer.getData("application/x-tcgstudio-layer-id");
        const pos = dropPos;
        setDropPos(null);
        if (pos === "inside" && id && onMoveToParent) {
          // Drop inside this group → reparent.
          e.stopPropagation();
          onMoveToParent(layer.id);
          return;
        }
        if (!raw) return;
        const fromIndex = Number(raw);
        if (!Number.isFinite(fromIndex)) return;
        // Display order is reversed: a layer "above" me in the display goes
        // to a HIGHER underlying index (closer to top of canvas), "below" goes
        // to a LOWER index. Convert here.
        const targetIndex = pos === "above" ? index + 1 : index;
        const adjusted = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
        if (adjusted !== fromIndex) onMoveTo(adjusted);
      }}
      className={[
        "group relative flex flex-col text-xs",
        !layer.visible && "opacity-50",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "relative flex cursor-pointer items-center gap-1.5 px-2 py-1.5",
          selected
            ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
            : "text-ink-100 hover:bg-ink-800",
          dropPos === "inside" && "ring-2 ring-inset ring-accent-500/60 bg-accent-500/15",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {dropPos && dropPos !== "inside" && (
          <span
            aria-hidden="true"
            className={[
              "pointer-events-none absolute inset-x-0 h-0.5 bg-accent-500",
              dropPos === "above" ? "top-0" : "bottom-0",
            ].join(" ")}
          />
        )}
        {isGroup && onToggleCollapsed ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed();
            }}
            title={layer.collapsed ? "Expand group" : "Collapse group"}
            className="-ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-100"
          >
            {layer.collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </button>
        ) : (
          <span className="-ml-1 w-4" />
        )}
        <TypeBadge type={layer.type} />
        <EditableName name={layer.name} onChange={onRename} />
        <span className="ml-auto flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
          <IconButton title={layer.visible ? "Hide" : "Show"} onClick={onToggleVisible}>
            {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
          </IconButton>
          <IconButton title={layer.locked ? "Unlock" : "Lock"} onClick={onToggleLock}>
            {layer.locked ? <LockIcon /> : <UnlockIcon />}
          </IconButton>
          <IconButton title="Move up" onClick={onMoveUp} disabled={index === total - 1}>
            <ArrowUpIcon />
          </IconButton>
          <IconButton title="Move down" onClick={onMoveDown} disabled={index === 0}>
            <ArrowDownIcon />
          </IconButton>
          <IconButton title="Duplicate" onClick={onDuplicate}>
            <CopyIcon />
          </IconButton>
          <IconButton title="Delete" onClick={onDelete} danger>
            <TrashIcon />
          </IconButton>
        </span>
      </div>
      {children}
      {ctx.element}
    </li>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6 L8 10 L12 6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 4 L10 8 L6 12" />
    </svg>
  );
}

function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-ink-400">{title}</h2>
        {subtitle && <span className="text-[10px] text-ink-500">{subtitle}</span>}
      </div>
      {actions}
    </div>
  );
}

function EditableName({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  // Double-click to edit. Blur or Enter commits, Escape cancels.
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      className="truncate outline-none focus:rounded focus:bg-ink-700 focus:px-1"
      onClick={(e) => {
        // Single click should select the row, not enter edit mode. We let the
        // parent <li>'s onClick fire; this handler only stops the event from
        // bubbling when already focused for editing.
        if (document.activeElement === e.currentTarget) e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const range = document.createRange();
        range.selectNodeContents(e.currentTarget);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        } else if (e.key === "Escape") {
          (e.currentTarget as HTMLElement).innerText = name;
          (e.currentTarget as HTMLElement).blur();
        }
      }}
      onBlur={(e) => {
        const next = (e.currentTarget.innerText || "").trim();
        if (next && next !== name) onChange(next);
        else e.currentTarget.innerText = name;
      }}
    >
      {name}
    </span>
  );
}

function TypeBadge({ type }: { type: Layer["type"] }) {
  const map: Record<Layer["type"], { label: string; color: string }> = {
    rect: { label: "▭", color: "text-ink-300" },
    text: { label: "T", color: "text-ink-300" },
    image: { label: "🖼", color: "text-ink-300" },
    zone: { label: "◧", color: "text-accent-300" },
    group: { label: "▼", color: "text-ink-300" },
  };
  const { label, color } = map[type];
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] ${color}`}
      aria-label={`Layer type: ${type}`}
    >
      {label}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      className={[
        "inline-flex h-5 w-5 items-center justify-center rounded text-ink-300 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30",
        danger && "hover:!bg-danger-500/20 hover:!text-danger-500",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

/* ----- icons ----- */
const ico = "h-3 w-3";
function EyeIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2l12 12M3 5C2.2 5.7 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.4 0 2.6-.5 3.6-1.1M14.5 8s-2.5-4.5-6.5-4.5c-.8 0-1.6.2-2.3.5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
function UnlockIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d="M5 7V5a3 3 0 0 1 5.8-1" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}
function ArrowDownIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M3 11V4a1 1 0 0 1 1-1h7" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l1 8h4l1-8" />
    </svg>
  );
}
