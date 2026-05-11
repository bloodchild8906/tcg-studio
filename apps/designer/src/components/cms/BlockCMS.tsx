import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  GripVertical,
  ChevronDown,
  Star,
  Code2,
  Layout,
  FileCode,
  Palette,
  Terminal,
  Settings,
  Monitor,
  Smartphone,
  Tablet as TabletIcon,
  Download,
  Upload,
  RotateCcw,
  X,
  Eye,
} from "./icons";
import {
  type Block,
  type BlockType,
  type BlockCMSProps,
  type BlockCmsTheme,
  BLOCK_CONFIGS,
  type CmsData,
  type ViewportMode,
  type BlockMetadata,
  newBlockId,
  EMPTY_CMS_DATA,
} from "./cms-types";

/**
 * Block CMS — visual page builder.
 *
 * Ported from the standalone `apps/designer/cms/` prototype. Major
 * adjustments vs. the source:
 *
 *  • framer-motion is gone. The prototype used `motion.div` + spring
 *    layout for the canvas animations; the designer app doesn't carry
 *    framer-motion and we don't want to pull it in just for fades.
 *    Plain Tailwind transitions cover the same affordances.
 *  • The toast notifications were sourced from a shadcn `use-toast`
 *    that doesn't exist in the designer. We use a tiny inlined
 *    `notify` helper instead — non-fatal "your save failed" messages
 *    surface via the parent's error UI, not from inside the builder.
 *  • The `storageTarget` autosave path (POST /api/persist) is gone.
 *    The parent component owns persistence — it sees every state
 *    change via `onDataChange` and decides when to call the real
 *    CMS API.
 *  • The "Save Changes" sidebar button is hidden; the surrounding
 *    PageEditor already shows a Save/Publish bar with proper
 *    dirty tracking. Keeping two save buttons would be confusing.
 *  • Adds `duplicateBlock` — the source called it but never defined it.
 *
 * Everything else (the block tree, drag/drop, palette, code editor,
 * preview, viewport switcher, undo/redo, JSON import/export) is
 * carried over.
 */

// --- Recursive State Helpers ---

const updateBlockInTree = (
  blocks: Block[],
  id: string,
  updater: (block: Block) => Block,
): Block[] => {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.children) {
      return { ...block, children: updateBlockInTree(block.children, id, updater) };
    }
    return block;
  });
};

const deleteBlockFromTree = (blocks: Block[], id: string): Block[] => {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => {
      if (block.children) {
        return { ...block, children: deleteBlockFromTree(block.children, id) };
      }
      return block;
    });
};

const findBlockById = (blocks: Block[], id: string): Block | null => {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return null;
};

const cloneBlock = (block: Block): Block => ({
  ...block,
  id: newBlockId(),
  children: block.children?.map(cloneBlock),
});

/**
 * Tiny class-name join. Filters falsy entries so call-sites can do
 *   cn("base", cond && "active", other)
 * without checking for undefined. Avoids pulling in a `clsx` dep.
 */
function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Minimal toast replacement. The prototype showed shadcn toasts;
 *  we surface to the console + `alert` for failures — non-critical
 *  feedback like "import successful" is silent. */
function notifyError(message: string) {
  // eslint-disable-next-line no-console
  console.error("[BlockCMS]", message);
  if (typeof window !== "undefined") {
    // alert is intentionally simple — the parent's main UI surfaces
    // the user-visible state. This is only for hard-fail import errors.
    window.alert(message);
  }
}

// --- Sub-Components ---

const SettingsPanel = ({
  block,
  onUpdate,
  onClose,
}: {
  block: Block;
  onUpdate: (metadata: BlockMetadata) => void;
  onClose: () => void;
}) => {
  const meta = block.metadata || {};

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-ink-700 bg-ink-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-800/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Settings className="h-4 w-4 text-accent-500" />
          {block.type.toUpperCase()} settings
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink-400">
            Spacing
          </p>
          <div className="grid grid-cols-2 gap-4">
            <SettingsInput
              label="Padding"
              value={meta.padding}
              onChange={(v) => onUpdate({ ...meta, padding: v })}
              placeholder="e.g. 4, 8, 12"
            />
            <SettingsInput
              label="Margin (Y)"
              value={meta.margin}
              onChange={(v) => onUpdate({ ...meta, margin: v })}
              placeholder="e.g. 4, 8"
            />
          </div>
        </section>

        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink-400">
            Styling
          </p>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-ink-400">
                Background color
              </span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={meta.backgroundColor || "#ffffff"}
                  onChange={(e) => onUpdate({ ...meta, backgroundColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded-md border border-ink-700"
                />
                <input
                  type="text"
                  value={meta.backgroundColor || ""}
                  onChange={(e) => onUpdate({ ...meta, backgroundColor: e.target.value })}
                  className={SETTINGS_INPUT}
                  placeholder="#hex or rgba"
                />
              </div>
            </div>
            <SettingsInput
              label="Border radius"
              value={meta.borderRadius}
              onChange={(v) => onUpdate({ ...meta, borderRadius: v })}
              placeholder="e.g. 8px, 1rem"
            />
          </div>
        </section>

        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink-400">
            Advanced
          </p>
          <div className="space-y-4">
            <SettingsInput
              label="Custom CSS classes"
              value={meta.customClass}
              onChange={(v) => onUpdate({ ...meta, customClass: v })}
              placeholder="Tailwind or custom classes"
            />
            {block.type === "image" && (
              <SettingsInput
                label="Alt text"
                value={meta.altText}
                onChange={(v) => onUpdate({ ...meta, altText: v })}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const SETTINGS_INPUT =
  "flex-1 rounded-md border border-ink-700 bg-ink-800/50 px-3 py-1.5 text-xs text-ink-100 outline-none focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

function SettingsInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn("w-full", SETTINGS_INPUT)}
        placeholder={placeholder}
      />
    </div>
  );
}

// --- Main Component ---

/**
 * Turn a theme prop into the CSS-variable map that the preview pane
 * (and any themed bits of the editor surface) read. We define a
 * `var(--cms-foo, fallback)` everywhere theme actually matters, so an
 * empty theme prop falls through to the studio's accent palette and
 * the editor still looks reasonable.
 */
function themeVars(theme: BlockCmsTheme | undefined): React.CSSProperties {
  if (!theme) return {};
  const vars: Record<string, string> = {};
  if (theme.accent) vars["--cms-accent"] = theme.accent;
  if (theme.surface) vars["--cms-surface"] = theme.surface;
  if (theme.text) vars["--cms-text"] = theme.text;
  if (theme.bodyFont) vars["--cms-body-font"] = theme.bodyFont;
  if (theme.headingFont) vars["--cms-heading-font"] = theme.headingFont;
  if (typeof theme.radius === "number") {
    vars["--cms-radius"] = `${theme.radius}px`;
  }
  return vars as React.CSSProperties;
}

export const BlockCMS = ({
  initialData,
  onDataChange,
  theme,
  sidebarWidth = "w-64",
  editorWidth = "flex-1",
}: BlockCMSProps) => {
  const [data, setData] = useState<CmsData>(initialData ?? EMPTY_CMS_DATA);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [activeTab, setActiveTab] = useState<"blocks" | "code">("blocks");
  const [activeCodeTab, setActiveCodeTab] = useState<"html" | "css" | "js">("html");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  // History (undo/redo).
  const [history, setHistory] = useState<CmsData[]>([]);
  const [redoStack, setRedoStack] = useState<CmsData[]>([]);

  // Snapshot so we only emit onDataChange when the value actually
  // shifts — not on every re-render.
  const lastEmitted = useRef<string>(JSON.stringify(initialData ?? EMPTY_CMS_DATA));

  // Re-seed state when the parent swaps `initialData` (e.g. user opens
  // a different page). Compare by JSON identity so an unchanged prop
  // doesn't reset the editor and lose undo state.
  useEffect(() => {
    if (!initialData) return;
    const serialized = JSON.stringify(initialData);
    if (serialized === lastEmitted.current) return;
    setData(initialData);
    setHistory([]);
    setRedoStack([]);
    lastEmitted.current = serialized;
  }, [initialData]);

  // Emit upward on every change. The parent owns persistence.
  useEffect(() => {
    const serialized = JSON.stringify(data);
    if (serialized === lastEmitted.current) return;
    lastEmitted.current = serialized;
    onDataChange?.(data);
  }, [data, onDataChange]);

  const pushToHistory = useCallback((next: CmsData) => {
    setHistory((prev) => {
      // Cap history to the most recent 50 entries so a long editing
      // session doesn't grow memory unbounded.
      const trimmed = prev.length >= 50 ? prev.slice(prev.length - 49) : prev;
      return [...trimmed, data];
    });
    setRedoStack([]);
    setData(next);
    // The data ref above will be stale by the time the closure runs
    // again, but that's fine — `prev` from the setHistory callback is
    // the correct prior state because state updates batch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setRedoStack((rs) => [...rs, data]);
      setData(previous);
      return prev.slice(0, -1);
    });
  }, [data]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setHistory((h) => [...h, data]);
      setData(next);
      return prev.slice(0, -1);
    });
  }, [data]);

  // Keyboard shortcuts — scoped to the editor so they don't fight
  // with global app shortcuts. We listen on `window` and only
  // intercept when the editor has DOM focus.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const within = wrapperRef.current?.contains(document.activeElement);
      if (!within) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [undo, redo]);

  // --- Actions ---

  const addBlock = (type: BlockType, parentId?: string) => {
    const config = BLOCK_CONFIGS.find((c) => c.type === type);
    const newBlock: Block = {
      id: newBlockId(),
      type,
      content: config?.defaultContent || "",
      children: config?.defaultChildren ? config.defaultChildren() : undefined,
      metadata: config?.defaultMetadata || {},
    };

    let newBlocks: Block[];
    if (!parentId) {
      newBlocks = [...data.blocks, newBlock];
    } else {
      newBlocks = updateBlockInTree(data.blocks, parentId, (block) => ({
        ...block,
        children: [...(block.children || []), newBlock],
      }));
    }
    pushToHistory({ ...data, blocks: newBlocks });
  };

  const deleteBlock = (id: string) => {
    pushToHistory({ ...data, blocks: deleteBlockFromTree(data.blocks, id) });
  };

  /** Drop a copy of `id` immediately after the original — inserted
   *  at the same depth so duplicating a child stays in its column. */
  const duplicateBlock = (id: string) => {
    const original = findBlockById(data.blocks, id);
    if (!original) return;
    const copy = cloneBlock(original);

    const insertAfter = (list: Block[]): Block[] => {
      const idx = list.findIndex((b) => b.id === id);
      if (idx !== -1) {
        const out = [...list];
        out.splice(idx + 1, 0, copy);
        return out;
      }
      return list.map((b) =>
        b.children ? { ...b, children: insertAfter(b.children) } : b,
      );
    };

    pushToHistory({ ...data, blocks: insertAfter(data.blocks) });
  };

  const clearCanvas = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Clear the entire canvas? This can be undone with Ctrl+Z.")
    ) {
      return;
    }
    pushToHistory({ ...data, blocks: [] });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cms-page.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        // Light shape check so we don't blow up the editor on a bad file.
        if (!imported || !Array.isArray(imported.blocks)) {
          throw new Error("File doesn't look like a CMS export.");
        }
        pushToHistory({
          blocks: imported.blocks,
          globalHtml: imported.globalHtml ?? "",
          globalCss: imported.globalCss ?? "",
          globalJs: imported.globalJs ?? "",
        });
      } catch (error) {
        notifyError(
          `Import failed: ${error instanceof Error ? error.message : "Invalid JSON."}`,
        );
      }
    };
    reader.readAsText(file);
    // Reset the input so re-picking the same file fires onChange again.
    e.target.value = "";
  };

  const updateBlockContent = (id: string, content: string) => {
    setData((prev) => ({
      ...prev,
      blocks: updateBlockInTree(prev.blocks, id, (block) => ({ ...block, content })),
    }));
  };

  const updateBlockMetadata = (id: string, metadata: BlockMetadata) => {
    pushToHistory({
      ...data,
      blocks: updateBlockInTree(data.blocks, id, (block) => ({ ...block, metadata })),
    });
  };

  // --- DnD ---

  const handleDrop = (e: React.DragEvent, targetId: string, isNested = false) => {
    e.preventDefault();
    setDropTargetId(null);
    if (!draggedId || draggedId === targetId) return;

    const draggedBlock = findBlockById(data.blocks, draggedId);
    if (!draggedBlock) return;
    // Refuse to drop a parent inside its own descendant.
    if (findBlockById(draggedBlock.children || [], targetId)) {
      setDraggedId(null);
      return;
    }

    const moveRecursive = (blocks: Block[]): Block[] => {
      const filtered = deleteBlockFromTree(blocks, draggedId);
      if (isNested) {
        return updateBlockInTree(filtered, targetId, (block) => ({
          ...block,
          children: [...(block.children || []), draggedBlock],
        }));
      }
      const insertBeside = (list: Block[]): Block[] => {
        const index = list.findIndex((b) => b.id === targetId);
        if (index !== -1) {
          const newList = [...list];
          newList.splice(index, 0, draggedBlock);
          return newList;
        }
        return list.map((b) =>
          b.children ? { ...b, children: insertBeside(b.children) } : b,
        );
      };
      return insertBeside(filtered);
    };

    pushToHistory({ ...data, blocks: moveRecursive(data.blocks) });
    setDraggedId(null);
  };

  // --- Renderers ---

  const EditorBlock = memo(({ block }: { block: Block }) => {
    const isColumn = block.type === "column";
    const isColumns = block.type === "columns";

    return (
      <div className="w-full">
        <div
          draggable={!isColumn}
          onDragStart={(e) => {
            e.stopPropagation();
            if (!isColumn) setDraggedId(block.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetId(block.id);
          }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={(e) => {
            e.stopPropagation();
            handleDrop(e, block.id, isColumn);
          }}
          className={cn(
            "group relative rounded-xl border-2 transition-all",
            isColumn
              ? "min-h-[120px] flex-1 border-dashed border-ink-700 p-2"
              : "mb-4 border-ink-700 bg-ink-900 p-5 hover:border-accent-500/40 hover:shadow-xl",
            draggedId === block.id && "scale-95 border-accent-500 bg-accent-500/5 opacity-50",
            dropTargetId === block.id && "border-accent-500 ring-4 ring-accent-500/10",
          )}
        >
          {!isColumn && (
            <div className="absolute left-3 top-3 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="cursor-move rounded p-1 hover:bg-ink-800">
                <GripVertical className="h-4 w-4 text-ink-500" />
              </div>
            </div>
          )}

          <div className={cn("flex flex-col", !isColumn && "ml-8")}>
            {isColumns ? (
              <div className="flex min-h-[140px] gap-4">
                {block.children?.map((child) => (
                  <EditorBlock key={child.id} block={child} />
                ))}
              </div>
            ) : isColumn ? (
              <div className="flex h-full flex-col space-y-2">
                {block.children?.map((child) => (
                  <EditorBlock key={child.id} block={child} />
                ))}
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  {block.children?.length === 0 && (
                    <span className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-ink-500 opacity-40">
                      Empty zone
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => addBlock("paragraph", block.id)}
                    className="rounded-full p-1.5 text-ink-500 transition-all hover:bg-accent-500/10 hover:text-accent-500"
                    title="Add paragraph"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-500/10">
                    <Layout className="h-3 w-3 text-accent-500" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
                    {block.type}
                  </span>
                </div>

                {(block.type === "heading" || block.type === "image" || block.type === "video") && (
                  <input
                    type="text"
                    value={block.content}
                    onChange={(e) => updateBlockContent(block.id, e.target.value)}
                    className={cn(
                      "w-full rounded-lg border border-transparent bg-transparent px-3 py-2 text-ink-100 outline-none hover:border-ink-700 focus:ring-2 focus:ring-accent-500/10",
                      block.type === "heading"
                        ? "text-xl font-bold"
                        : "font-mono text-xs text-ink-400",
                    )}
                    placeholder={
                      block.type === "image"
                        ? "Image URL (https://… or /asset/...)"
                        : block.type === "video"
                        ? "Embed URL (YouTube /embed/...)"
                        : "Heading text"
                    }
                  />
                )}
                {(
                  [
                    "paragraph",
                    "code",
                    "list",
                    "quote",
                    "button",
                    "gallery",
                    "table",
                    "accordion",
                    "features",
                  ] as BlockType[]
                ).includes(block.type) && (
                  <textarea
                    value={block.content}
                    onChange={(e) => updateBlockContent(block.id, e.target.value)}
                    className={cn(
                      "min-h-[80px] w-full resize-none rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm leading-relaxed text-ink-100 outline-none hover:border-ink-700 focus:ring-2 focus:ring-accent-500/10",
                      block.type === "code" && "bg-ink-950 p-4 font-mono text-[11px] text-emerald-300",
                    )}
                    placeholder={`${block.type.toUpperCase()} content…`}
                    spellCheck={false}
                  />
                )}
                {block.type === "divider" && <div className="my-4 h-px w-full bg-ink-700" />}
              </div>
            )}
          </div>

          {!isColumn && (
            <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setEditingBlockId(block.id)}
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-accent-500"
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => duplicateBlock(block.id)}
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
                title="Duplicate"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => deleteBlock(block.id)}
                className="rounded-lg p-1.5 text-danger-500/70 transition-colors hover:bg-danger-500/10 hover:text-danger-500"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  });
  EditorBlock.displayName = "EditorBlock";

  const PreviewBlock = ({ block }: { block: Block }) => {
    const meta = block.metadata || {};
    // Per-block overrides land in `style`. Per-block backgroundColor +
    // borderRadius beat the theme — that's by design, because block-
    // level metadata is intentional user authoring on top of the theme.
    const style: React.CSSProperties = {
      padding: meta.padding ? `${parseInt(meta.padding) * 0.25}rem` : undefined,
      marginTop: meta.margin ? `${parseInt(meta.margin) * 0.125}rem` : undefined,
      marginBottom: meta.margin ? `${parseInt(meta.margin) * 0.125}rem` : undefined,
      backgroundColor: meta.backgroundColor,
      borderRadius: meta.borderRadius,
    };

    const renderContent = () => {
      switch (block.type) {
        case "columns":
          return (
            <div className="flex flex-wrap gap-8 md:flex-nowrap">
              {block.children?.map((col) => {
                // Per-column width hint stored on column.metadata.widthFr
                // (e.g. 1, 2, 3 — interpreted as `flex-grow` so the row
                // splits proportionally). Defaults to 1 so a single value
                // gives the existing equal-width behaviour. The page-
                // builder's metadata editor + drag-handle UI write this
                // field; the operator can also set it directly as JSON.
                const meta = (col.metadata ?? {}) as { widthFr?: number };
                const fr = typeof meta.widthFr === "number" && meta.widthFr > 0 ? meta.widthFr : 1;
                return (
                  <div
                    key={col.id}
                    className="space-y-4"
                    style={{ flex: `${fr} 1 0%`, minWidth: 0 }}
                  >
                    {col.children?.map((child) => (
                      <PreviewBlock key={child.id} block={child} />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        case "heading":
          return (
            <h1
              className="text-4xl font-bold leading-tight"
              style={{
                color: "var(--cms-text, #e6e9ee)",
                fontFamily: "var(--cms-heading-font, inherit)",
              }}
            >
              {block.content}
            </h1>
          );
        case "paragraph":
          return (
            <p
              className="text-lg font-light leading-relaxed"
              style={{
                color: "var(--cms-text, rgba(230,233,238,0.85))",
                fontFamily: "var(--cms-body-font, inherit)",
              }}
            >
              {block.content}
            </p>
          );
        case "image":
          return block.content ? (
            <img
              src={block.content}
              alt={meta.altText || ""}
              className="h-auto w-full shadow-sm"
              style={{ borderRadius: "var(--cms-radius, 0.5rem)" }}
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-ink-700 text-xs text-ink-500">
              (image URL not set)
            </div>
          );
        case "code":
          return (
            <pre className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-950 p-6 font-mono text-[13px] text-emerald-400">
              {block.content}
            </pre>
          );
        case "list":
          return (
            <ul className="space-y-3">
              {block.content.split("\n").map((item, i) => (
                <li key={i} className="flex items-start gap-4">
                  <span
                    className="mt-2.5 h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: "var(--cms-accent, #d4a24c)" }}
                  />
                  <span
                    className="text-lg"
                    style={{
                      color: "var(--cms-text, rgba(230,233,238,0.85))",
                      fontFamily: "var(--cms-body-font, inherit)",
                    }}
                  >
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          );
        case "quote": {
          const [text, author] = block.content.split("|").map((s) => s.trim());
          return (
            <div className="relative py-4">
              <div
                className="absolute -left-4 top-0 font-serif text-6xl"
                style={{ color: "color-mix(in srgb, var(--cms-accent, #d4a24c) 10%, transparent)" }}
              >
                "
              </div>
              <blockquote
                className="border-l-4 pl-8"
                style={{ borderColor: "var(--cms-accent, #d4a24c)" }}
              >
                <p
                  className="mb-4 text-2xl font-light italic"
                  style={{ color: "var(--cms-text, rgba(230,233,238,0.85))" }}
                >
                  "{text}"
                </p>
                {author && (
                  <footer className="text-sm font-bold uppercase tracking-widest text-ink-400">
                    — {author}
                  </footer>
                )}
              </blockquote>
            </div>
          );
        }
        case "video":
          return (
            <div className="aspect-video overflow-hidden rounded-2xl border border-ink-800 bg-black shadow-2xl">
              {block.content ? (
                <iframe
                  src={block.content}
                  className="h-full w-full"
                  allowFullScreen
                  title="Embedded video"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-ink-500">
                  (video URL not set)
                </div>
              )}
            </div>
          );
        case "button": {
          const [text, btnStyle, url] = block.content.split("|").map((s) => s.trim());
          const isSecondary = btnStyle === "secondary";
          return (
            <a
              href={url || "#"}
              className="inline-flex items-center justify-center px-8 py-4 font-bold shadow-lg transition-transform hover:scale-105 active:scale-95"
              style={{
                background: isSecondary
                  ? "var(--cms-surface, #161a22)"
                  : "var(--cms-accent, #d4a24c)",
                color: isSecondary ? "var(--cms-text, #e6e9ee)" : "#0b0d10",
                borderRadius: "var(--cms-radius, 0.75rem)",
              }}
            >
              {text}
            </a>
          );
        }
        case "divider":
          return (
            <hr
              className="my-12 border-0"
              style={{
                height: 1,
                background:
                  "color-mix(in srgb, var(--cms-accent, #d4a24c) 35%, transparent)",
              }}
            />
          );
        case "gallery": {
          const images = block.content.split("\n").filter((url) => url.trim());
          return (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
              {images.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="h-56 w-full rounded-2xl border border-ink-800 object-cover shadow-md transition-transform hover:scale-105"
                />
              ))}
            </div>
          );
        }
        case "table": {
          const rows = block.content
            .split("\n")
            .map((row) => row.split("|").map((cell) => cell.trim()));
          return (
            <div className="overflow-hidden rounded-2xl border border-ink-700 shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {rows[0]?.map((cell, i) => (
                      <th
                        key={i}
                        className="border-b border-ink-700 bg-ink-800/50 px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-ink-100"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((row, i) => (
                    <tr key={i} className="transition-colors hover:bg-ink-800/20">
                      {row.map((cell, j) => (
                        <td key={j} className="border-b border-ink-800/50 px-6 py-4 text-ink-200">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        case "accordion": {
          const items = block.content.split("\n\n").map((item) => {
            const [q, a] = item.split("|").map((s) => s.trim());
            return { q, a };
          });
          return (
            <div className="space-y-3">
              {items.map((item, i) => (
                <details
                  key={i}
                  className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
                >
                  <summary className="flex cursor-pointer items-center justify-between px-6 py-4 font-bold text-ink-100 hover:bg-ink-800/30">
                    {item.q}
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-ink-800/50 bg-ink-800/10 px-6 py-4 leading-relaxed text-ink-200">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          );
        }
        case "features": {
          const feats = block.content.split("\n").map((feat) => {
            const [title, desc] = feat.split("|").map((s) => s.trim());
            return { title, desc };
          });
          return (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {feats.map((feat, i) => (
                <div
                  key={i}
                  className="border p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl"
                  style={{
                    borderRadius: "var(--cms-radius, 1.5rem)",
                    borderColor:
                      "color-mix(in srgb, var(--cms-accent, #d4a24c) 18%, transparent)",
                    background: "var(--cms-surface, #11141a)",
                  }}
                >
                  <div
                    className="mb-6 flex h-12 w-12 items-center justify-center"
                    style={{
                      borderRadius: "var(--cms-radius, 1rem)",
                      background:
                        "color-mix(in srgb, var(--cms-accent, #d4a24c) 12%, transparent)",
                    }}
                  >
                    <Star className="h-6 w-6" style={{ color: "var(--cms-accent, #d4a24c)" }} />
                  </div>
                  <h3
                    className="mb-3 text-xl font-bold"
                    style={{
                      color: "var(--cms-text, #e6e9ee)",
                      fontFamily: "var(--cms-heading-font, inherit)",
                    }}
                  >
                    {feat.title}
                  </h3>
                  <p
                    className="leading-relaxed"
                    style={{
                      color: "var(--cms-text, rgba(230,233,238,0.7))",
                      fontFamily: "var(--cms-body-font, inherit)",
                    }}
                  >
                    {feat.desc}
                  </p>
                </div>
              ))}
            </div>
          );
        }
        default:
          return null;
      }
    };

    return (
      <div style={style} className={meta.customClass}>
        {renderContent()}
      </div>
    );
  };

  // Run user-supplied global JS once in a sandboxed function call.
  // This is intentionally trusting — the same operator that types the
  // CSS/HTML also types the JS, and the editor isn't a public surface.
  useEffect(() => {
    if (!data.globalJs) return;
    try {
      const script = document.createElement("script");
      script.text = `(function(){ ${data.globalJs} })();`;
      document.body.appendChild(script);
      return () => {
        if (script.parentNode) script.parentNode.removeChild(script);
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[BlockCMS] Global JS error:", error);
    }
  }, [data.globalJs]);

  return (
    <div
      ref={wrapperRef}
      className="flex h-full overflow-hidden bg-ink-950 text-ink-100"
      style={themeVars(theme)}
    >
      <style>{data.globalCss}</style>

      {/* Settings overlay */}
      {editingBlockId && (
        <>
          <div
            onClick={() => setEditingBlockId(null)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <SettingsPanel
            block={findBlockById(data.blocks, editingBlockId)!}
            onUpdate={(meta) => updateBlockMetadata(editingBlockId, meta)}
            onClose={() => setEditingBlockId(null)}
          />
        </>
      )}

      {/* Sidebar */}
      <aside className={cn(sidebarWidth, "z-30 flex flex-col border-r border-ink-800 bg-ink-900")}>
        <div className="flex border-b border-ink-800 bg-ink-800/10 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("blocks")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-[10px] font-black uppercase tracking-widest transition-all",
              activeTab === "blocks"
                ? "bg-ink-900 text-accent-500 shadow-sm"
                : "text-ink-400 hover:text-ink-100",
            )}
          >
            <Layout className="h-3.5 w-3.5" /> Blocks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("code")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-[10px] font-black uppercase tracking-widest transition-all",
              activeTab === "code"
                ? "bg-ink-900 text-accent-500 shadow-sm"
                : "text-ink-400 hover:text-ink-100",
            )}
          >
            <Code2 className="h-3.5 w-3.5" /> Dev
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "blocks" ? (
            <div className="space-y-8 p-5">
              {(["Layout", "Basic", "Advanced"] as const).map((cat) => (
                <div key={cat}>
                  <p className="mb-4 px-2 text-[10px] font-black uppercase tracking-[0.2em] text-ink-500 opacity-50">
                    {cat}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {BLOCK_CONFIGS.filter((c) => c.category === cat).map(
                      ({ icon: Icon, label, type }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => addBlock(type)}
                          className="group flex w-full items-center justify-between rounded-xl border border-transparent bg-transparent px-4 py-3 text-xs font-bold text-ink-100 transition-all hover:border-accent-500/20 hover:bg-accent-500/5"
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="h-4 w-4 text-ink-400 transition-colors group-hover:text-accent-500" />
                            {label}
                          </div>
                          <Plus className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="m-4 flex rounded-xl bg-ink-800/30 p-1">
                {(
                  [
                    { id: "html", icon: FileCode },
                    { id: "css", icon: Palette },
                    { id: "js", icon: Terminal },
                  ] as const
                ).map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveCodeTab(id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[10px] font-black transition-all",
                      activeCodeTab === id
                        ? "bg-ink-900 text-accent-500 shadow-sm"
                        : "text-ink-400 hover:text-ink-100",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {id.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex-1 px-4 pb-4">
                <textarea
                  value={
                    activeCodeTab === "html"
                      ? data.globalHtml
                      : activeCodeTab === "css"
                      ? data.globalCss
                      : data.globalJs
                  }
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      [activeCodeTab === "html"
                        ? "globalHtml"
                        : activeCodeTab === "css"
                        ? "globalCss"
                        : "globalJs"]: e.target.value,
                    }))
                  }
                  className="h-full w-full resize-none rounded-2xl border border-ink-800 bg-ink-950 p-5 font-mono text-[11px] leading-relaxed text-emerald-400 outline-none focus:ring-2 focus:ring-accent-500/20"
                  placeholder={`// Custom ${activeCodeTab.toUpperCase()} code...`}
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 border-t border-ink-800 bg-ink-800/5 p-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={undo}
                disabled={history.length === 0}
                className="rounded-lg p-2 transition-all hover:bg-ink-800 disabled:opacity-30"
                title="Undo (Ctrl+Z)"
              >
                <RotateCcw className="h-4 w-4 scale-x-[-1]" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={redoStack.length === 0}
                className="rounded-lg p-2 transition-all hover:bg-ink-800 disabled:opacity-30"
                title="Redo (Ctrl+Y)"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={clearCanvas}
              className="rounded-lg p-2 text-danger-500/70 transition-all hover:bg-danger-500/10 hover:text-danger-500"
              title="Clear canvas"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <div className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-800/50 px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-ink-100 transition-all hover:bg-ink-800">
                <Upload className="h-3 w-3" /> Import
              </div>
              <input type="file" accept=".json" onChange={importJson} className="hidden" />
            </label>
            <button
              type="button"
              onClick={exportJson}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-800/50 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-ink-100 transition-all hover:bg-ink-800"
            >
              <Download className="h-3 w-3" /> Export
            </button>
          </div>
        </div>
      </aside>

      {/* Editor + preview */}
      <div className="flex flex-1 overflow-hidden">
        <main
          className={cn(
            editorWidth,
            "relative overflow-y-auto border-r border-ink-800 bg-ink-800/5",
          )}
        >
          <div className="mx-auto min-h-full max-w-2xl p-10">
            <header className="mb-10 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Page canvas</h2>
                <p className="mt-1 text-xs font-medium text-ink-500">
                  Drag blocks from the palette to build the page.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-sm">
                {(["desktop", "tablet", "mobile"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewport(mode)}
                    className={cn(
                      "rounded p-1.5 transition-all",
                      viewport === mode
                        ? "bg-accent-500 text-ink-950"
                        : "text-ink-400 hover:bg-ink-800",
                    )}
                    title={mode}
                  >
                    {mode === "desktop" ? (
                      <Monitor className="h-3.5 w-3.5" />
                    ) : mode === "tablet" ? (
                      <TabletIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Smartphone className="h-3.5 w-3.5" />
                    )}
                  </button>
                ))}
              </div>
            </header>

            {data.blocks.length === 0 ? (
              <div className="rounded-[2rem] border-2 border-dashed border-ink-700 bg-ink-900/30 py-32 text-center backdrop-blur-sm">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent-500/10">
                  <Plus className="h-10 w-10 text-accent-500 opacity-40" />
                </div>
                <p className="text-lg font-bold text-ink-300">Ready to build?</p>
                <p className="mt-2 text-xs font-medium tracking-wide text-ink-500">
                  Choose a block from the palette to start your page.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {data.blocks.map((block) => (
                  <EditorBlock key={block.id} block={block} />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* `min-h-0` is essential on flex children that must SHRINK to
            make their `overflow-y-auto` descendant scroll. Without it
            the flex item grows to fit its content and the scroll
            container expands instead of scrolling — the symptom the
            operator sees is the preview pane cutting off long pages
            with no scrollbar. */}
        <section className="flex min-h-0 flex-1 flex-col bg-ink-950">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-6">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-danger-500/30" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400/30" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/30" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-ink-400 opacity-60">
                Live preview
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="rounded bg-ink-800/50 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-400">
                {viewport} mode
              </div>
              <Eye className="h-3.5 w-3.5 text-ink-500" />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-12">
            <div
              style={{
                width:
                  viewport === "mobile" ? 375 : viewport === "tablet" ? 768 : "100%",
                background: "var(--cms-surface, #11141a)",
                color: "var(--cms-text, #e6e9ee)",
                fontFamily: "var(--cms-body-font, inherit)",
                borderRadius: "var(--cms-radius, 1rem)",
                borderColor:
                  "color-mix(in srgb, var(--cms-accent, #d4a24c) 14%, rgba(255,255,255,0.04))",
              }}
              className="min-h-full origin-top overflow-hidden border shadow-2xl transition-all"
            >
              <div className="p-12">
                <div dangerouslySetInnerHTML={{ __html: data.globalHtml }} />
                <div className="mt-6 space-y-12">
                  {data.blocks.map((block) => (
                    <div key={block.id}>
                      <PreviewBlock block={block} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BlockCMS;
