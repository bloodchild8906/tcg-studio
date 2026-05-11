import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { Block } from "@/lib/apiTypes";

/**
 * Block manager modal (sec 27.3).
 *
 * Compact CRUD for the project's blocks — name, slug, color, order, status.
 * Used as a satellite to the SetsView, since the typical workflow goes:
 *   1. open Sets view
 *   2. realize you want blocks
 *   3. open Manage blocks → create them inline
 *   4. assign sets to blocks via the SetEditor's block picker
 *
 * No separate "Blocks view" yet — most users will only have a handful of
 * blocks per project, and a list-and-edit modal handles that fine.
 * Promotion to a top-level view is a follow-up if blocks grow rich
 * features (per-block lore, draft environment, etc.).
 */
export function BlockManagerModal({
  open,
  projectId,
  blocks,
  onClose,
  onChanged,
}: {
  open: boolean;
  projectId: string | null;
  blocks: Block[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draftName, setDraftName] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [draftColor, setDraftColor] = useState("#7a4ed1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftName("");
    setDraftSlug("");
    setDraftColor("#7a4ed1");
    setError(null);
  }, [open]);

  if (!open || !projectId) return null;

  async function create() {
    if (!draftName || !draftSlug || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createBlock({
        projectId,
        name: draftName,
        slug: draftSlug,
        color: draftColor,
      });
      onChanged();
      setDraftName("");
      setDraftSlug("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchBlock(id: string, patch: Partial<Block>) {
    try {
      await api.updateBlock(id, patch);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  async function deleteBlock(b: Block) {
    if (!confirm(`Delete block "${b.name}"? Sets keep their cards but lose the grouping.`))
      return;
    try {
      await api.deleteBlock(b.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage blocks"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Blocks</h2>
            <p className="text-[11px] text-ink-500">
              Story arcs / seasons that group sets within this project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-2 text-xs font-medium text-ink-50">Existing</h3>
          {blocks.length === 0 ? (
            <p className="rounded border border-dashed border-ink-700 px-3 py-4 text-center text-[11px] text-ink-500">
              No blocks yet — create one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {blocks.map((b) => (
                <li
                  key={b.id}
                  className="grid grid-cols-[40px_1fr_120px_80px_28px] items-center gap-2 rounded border border-ink-800 bg-ink-950/40 p-2"
                >
                  <input
                    type="color"
                    value={b.color}
                    onChange={(e) => void patchBlock(b.id, { color: e.target.value })}
                    className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
                    title="Color"
                  />
                  <BlockNameInput block={b} onCommit={(v) => patchBlock(b.id, { name: v })} />
                  <BlockSlugInput block={b} onCommit={(v) => patchBlock(b.id, { slug: v })} />
                  <select
                    value={b.status}
                    onChange={(e) => void patchBlock(b.id, { status: e.target.value })}
                    className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                  >
                    {["draft", "active", "concluded", "archived"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => deleteBlock(b)}
                    title="Delete block"
                    className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 mb-2 text-xs font-medium text-ink-50">New block</h3>
          <div className="grid grid-cols-[40px_1fr_140px_auto] items-center gap-2 rounded border border-ink-800 bg-ink-950/40 p-2">
            <input
              type="color"
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
            />
            <input
              type="text"
              value={draftName}
              onChange={(e) => {
                const v = e.target.value;
                setDraftName(v);
                // Auto-derive slug while it's still empty/synced.
                if (!draftSlug || draftSlug === slugify(draftName)) {
                  setDraftSlug(slugify(v));
                }
              }}
              placeholder="Block name (e.g. Crimson Dawn)"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
            <input
              type="text"
              value={draftSlug}
              onChange={(e) => setDraftSlug(e.target.value)}
              placeholder="slug"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs font-mono text-ink-100"
            />
            <button
              type="button"
              onClick={create}
              disabled={busy || !draftName || !draftSlug}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
            >
              {busy ? "…" : "Create"}
            </button>
          </div>
        </div>

        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Name input with commit-on-blur — keeps editing fluid without a per-keystroke save. */
function BlockNameInput({
  block,
  onCommit,
}: {
  block: Block;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(block.name);
  useEffect(() => setV(block.name), [block.name]);
  return (
    <input
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== block.name && v.trim().length > 0) onCommit(v.trim());
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
    />
  );
}

function BlockSlugInput({
  block,
  onCommit,
}: {
  block: Block;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(block.slug);
  useEffect(() => setV(block.slug), [block.slug]);
  return (
    <input
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== block.slug && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v)) onCommit(v);
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs font-mono text-ink-100"
    />
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
