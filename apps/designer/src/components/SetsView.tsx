import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Block, CardSet } from "@/lib/apiTypes";
import { PackGeneratorModal } from "@/components/PackGeneratorModal";
import { BlockManagerModal } from "@/components/BlockManagerModal";

/**
 * Sets view — spec sec 27.
 *
 * Lists every set in the active project. Each tile shows code, status, card
 * count, release date, and inline action buttons. The "+ New set" tile opens
 * an inline form that POSTs and prepends the new set on success.
 *
 * Why a tenant-scoped state slice for sets isn't needed yet: the cards work
 * already filters cards by setId on demand (`api.listCards({ setId })`) and
 * the SetsView re-fetches its own list on mount. We can promote sets to a
 * top-level store slice when card editing wants to filter / pick a set.
 */
export function SetsView() {
  const project = useDesigner(selectActiveProject);
  const [sets, setSets] = useState<CardSet[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardSet | null>(null);
  const [packing, setPacking] = useState<CardSet | null>(null);
  const [blockManagerOpen, setBlockManagerOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setSets([]);
      setBlocks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch blocks and sets in parallel — they're independent and the
      // sets header shows block totals so we want both before render.
      const [s, b] = await Promise.all([
        api.listSets({ projectId: project.id }),
        api.listBlocks({ projectId: project.id }),
      ]);
      setSets(s);
      setBlocks(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Group sets by block — null/undefined block lands in the "Unblocked"
  // bucket. Block order follows block.sortOrder; sets keep their list order.
  const grouped = useMemo(() => {
    const byBlock = new Map<string, CardSet[]>();
    for (const s of sets) {
      const key = s.blockId ?? "__none__";
      const arr = byBlock.get(key);
      if (arr) arr.push(s);
      else byBlock.set(key, [s]);
    }
    const sortedBlocks = [...blocks].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    return { byBlock, sortedBlocks };
  }, [sets, blocks]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to see its sets.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Project: {project.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Sets</h1>
            <p className="mt-1 text-xs text-ink-400">
              {sets.length} set{sets.length === 1 ? "" : "s"} · {blocks.length} block
              {blocks.length === 1 ? "" : "s"} · groups cards by release.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBlockManagerOpen(true)}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
          >
            Manage blocks
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        {loading && sets.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Render each block as its own grid section. The "+ New set"
                tile sits inside the unblocked bucket so it's always
                visible, even if the project doesn't use blocks yet. */}
            {grouped.sortedBlocks.map((block) => (
              <SetGroupSection
                key={block.id}
                block={block}
                sets={grouped.byBlock.get(block.id) ?? []}
                onEdit={(s) => setEditing(s)}
                onPack={(s) => setPacking(s)}
                onDelete={async (s) => {
                  if (
                    !confirm(
                      `Delete set "${s.name}" (${s.code})?\nCards in it will become set-less but won't be deleted.`,
                    )
                  )
                    return;
                  try {
                    await api.deleteSet(s.id);
                    await refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "delete failed");
                  }
                }}
              />
            ))}
            <SetGroupSection
              block={null}
              sets={grouped.byBlock.get("__none__") ?? []}
              showNew
              projectId={project.id}
              onCreated={refresh}
              onEdit={(s) => setEditing(s)}
              onPack={(s) => setPacking(s)}
              onDelete={async (s) => {
                if (
                  !confirm(
                    `Delete set "${s.name}" (${s.code})?\nCards in it will become set-less but won't be deleted.`,
                  )
                )
                  return;
                try {
                  await api.deleteSet(s.id);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "delete failed");
                }
              }}
            />
          </div>
        )}
      </div>

      <SetEditor
        set={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        }}
      />

      <PackGeneratorModal
        set={packing}
        open={packing !== null}
        onClose={() => setPacking(null)}
        onSaved={(updated) => {
          setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        }}
      />

      <BlockManagerModal
        open={blockManagerOpen}
        projectId={project?.id ?? null}
        blocks={blocks}
        onClose={() => setBlockManagerOpen(false)}
        onChanged={refresh}
      />
    </div>
  );
}

/**
 * One block's worth of sets, rendered as a labeled section. The
 * unblocked bucket is rendered with `block={null}` and includes the
 * "+ New set" tile + a header that just says "Unblocked".
 */
function SetGroupSection({
  block,
  sets,
  showNew,
  projectId,
  onCreated,
  onEdit,
  onPack,
  onDelete,
}: {
  block: Block | null;
  sets: CardSet[];
  showNew?: boolean;
  projectId?: string;
  onCreated?: () => void;
  onEdit: (s: CardSet) => void;
  onPack: (s: CardSet) => void;
  onDelete: (s: CardSet) => void;
}) {
  // Skip empty unblocked sections unless we're showing the "+ New" tile.
  if (!block && sets.length === 0 && !showNew) return null;
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          {block && (
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ background: block.color }}
              aria-hidden="true"
            />
          )}
          <h2 className="text-sm font-semibold text-ink-100">
            {block ? block.name : "Unblocked"}
          </h2>
          <span className="text-[11px] text-ink-500">
            {sets.length} set{sets.length === 1 ? "" : "s"}
          </span>
        </div>
        {block?.description && (
          <p className="line-clamp-1 max-w-[40ch] text-[11px] text-ink-500">
            {block.description}
          </p>
        )}
      </header>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {showNew && projectId && onCreated && (
          <NewSetTile projectId={projectId} onCreated={onCreated} />
        )}
        {sets.map((s) => (
          <SetTile
            key={s.id}
            set={s}
            onEdit={() => onEdit(s)}
            onPack={() => onPack(s)}
            onDelete={() => onDelete(s)}
          />
        ))}
        {sets.length === 0 && !showNew && (
          <li className="col-span-full rounded border border-dashed border-ink-700 px-3 py-4 text-center text-[11px] text-ink-500">
            No sets in this block yet.
          </li>
        )}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Tile                                                                    */
/* ---------------------------------------------------------------------- */

function SetTile({
  set,
  onEdit,
  onPack,
  onDelete,
}: {
  set: CardSet;
  onEdit: () => void;
  onPack: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40">
      <button type="button" onClick={onEdit} className="flex flex-1 flex-col gap-2 p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink-50">{set.name}</h3>
            <p className="font-mono text-[10px] text-ink-500">
              <span className="rounded bg-ink-800 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-accent-300">
                {set.code}
              </span>
            </p>
          </div>
          <StatusPill status={set.status} />
        </div>
        {set.description && (
          <p className="line-clamp-2 text-[11px] leading-snug text-ink-400">
            {set.description}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
          <span>
            {set.cardCount ?? 0} card{(set.cardCount ?? 0) === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            {set.releaseDate ? new Date(set.releaseDate).toLocaleDateString() : "no release date"}
          </span>
        </div>
      </button>
      <div className="flex border-t border-ink-800">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onPack}
          className="flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          title="Configure pack rules and pull a sample pack"
        >
          Packs
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "border-ink-700 bg-ink-800 text-ink-400",
    design: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    playtesting: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    locked: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    archived: "border-ink-700 bg-ink-800 text-ink-600",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
        map[status] ?? map.draft
      }`}
    >
      {status}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* + new tile                                                              */
/* ---------------------------------------------------------------------- */

function NewSetTile({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  function deriveCode(n: string) {
    const upper = n.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return upper.slice(0, 4) || "SET";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createSet({
        projectId,
        name: name.trim(),
        code: code.trim() || deriveCode(name),
      });
      setName("");
      setCode("");
      setOpen(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300"
        >
          <span className="text-2xl">+</span>
          <span className="text-xs font-medium">New set</span>
          <span className="text-[10px] text-ink-500">Core, Expansion 1, …</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <form
        onSubmit={submit}
        className="flex h-full min-h-[160px] flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3"
      >
        <p className="text-[10px] uppercase tracking-wider text-accent-300">New set</p>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!code) setCode(deriveCode(e.target.value));
          }}
          placeholder="Core Set"
          autoFocus
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
          placeholder="CORE"
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] uppercase text-ink-100"
        />
        <p className="text-[10px] text-ink-500">
          Code is printed on the card. 2-4 uppercase letters / digits.
        </p>
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : "Create"}
          </button>
        </div>
      </form>
    </li>
  );
}

/* ---------------------------------------------------------------------- */
/* Editor modal                                                            */
/* ---------------------------------------------------------------------- */

function SetEditor({
  set,
  open,
  onClose,
  onSaved,
}: {
  set: CardSet | null;
  open: boolean;
  onClose: () => void;
  onSaved: (s: CardSet) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [status, setStatus] = useState("draft");
  const [blockId, setBlockId] = useState<string>("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !set) return;
    setName(set.name);
    setCode(set.code);
    setDescription(set.description);
    setReleaseDate(set.releaseDate ? set.releaseDate.slice(0, 10) : "");
    setStatus(set.status);
    setBlockId(set.blockId ?? "");
    setError(null);
    // Load blocks for the picker. Cheap — usually < 10 rows per project.
    void api
      .listBlocks({ projectId: set.projectId })
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, [open, set]);

  if (!open || !set) return null;

  async function save() {
    if (!set) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSet(set.id, {
        name,
        code,
        description,
        releaseDate: releaseDate ? `${releaseDate}T00:00:00.000Z` : null,
        status,
        blockId: blockId || null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${set.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-[min(560px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Edit set</h2>
            <p className="font-mono text-[11px] text-ink-500">{set.id}</p>
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
        <div className="space-y-3 p-4">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </Field>
          <Field label="Code" hint="Printed on cards. Uppercase A-Z / 0-9.">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] uppercase text-ink-100"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </Field>
          <Field label="Release date">
            <input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            >
              {["draft", "design", "playtesting", "locked", "released", "archived"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Block" hint="Optional — group this set under a story arc.">
            <select
              value={blockId}
              onChange={(e) => setBlockId(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            >
              <option value="">— Unblocked —</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}
        <footer className="flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}
