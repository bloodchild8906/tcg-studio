/**
 * Asset library — file explorer (sec 20).
 *
 * Replaces the flat asset grid with:
 *   • Folder tree on the left (collapsible, scrollable).
 *   • Breadcrumb + grid on the right showing the active folder's
 *     contents.
 *   • Multi-select with checkboxes; shift-click extends a range.
 *   • Bulk action bar that appears when 1+ items are selected:
 *     Move to folder, Delete, Submit for approval, Approve, Reject,
 *     Set visibility.
 *   • Approval status pills on each tile + a status filter at the top.
 *   • Drag & drop folder upload using `webkitdirectory` so a whole
 *     directory tree drops in (subfolders auto-created).
 *   • Right-click context menu mirrors the bulk actions for a single
 *     item, plus Open / Rename.
 *
 * Backend: `/api/v1/assets`, `/api/v1/asset-folders`, plus the bulk +
 * approval endpoints. Asset uploads now carry `folderId` so they
 * land in the active folder rather than always at the root.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approveAsset,
  assetBlobUrl,
  bulkAssetOp,
  createAssetFolder,
  deleteAsset,
  deleteAssetFolder,
  listAssets,
  listAssetFolders,
  rejectAsset,
  submitAssetForApproval,
  updateAssetFolder,
  uploadAsset,
  type AssetFolder,
  type BulkAssetAction,
} from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import { useContextMenu } from "@/components/ContextMenu";
import { ImageEditor } from "@/components/ImageEditor";

type StatusFilter = "all" | "draft" | "pending" | "approved" | "rejected";

export function AssetExplorerView() {
  const project = useDesigner(selectActiveProject);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Asset to open in the inline ImageEditor (modal). Driven by the
  // tile context menu's "Open in editor" action.
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [fs, as] = await Promise.all([
        listAssetFolders({ projectId: project?.id }),
        listAssets({
          projectId: project?.id,
          folderId: activeFolderId === null ? null : activeFolderId,
          status: statusFilter === "all" ? undefined : statusFilter,
          q: search.trim() || undefined,
          limit: 1000,
        } as Parameters<typeof listAssets>[0]),
      ]);
      setFolders(fs);
      setAssets(as);
      // Drop selections that are no longer in view.
      setSelectedAssetIds((prev) => {
        const next = new Set<string>();
        for (const a of as) if (prev.has(a.id)) next.add(a.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setBusy(false);
    }
  }, [project?.id, activeFolderId, statusFilter, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Build the folder breadcrumb from the active folder up to root.
  const breadcrumb = useMemo(() => {
    if (!activeFolderId) return [{ id: null as string | null, name: "All assets" }];
    const trail: Array<{ id: string | null; name: string }> = [];
    let cursor: string | null = activeFolderId;
    while (cursor) {
      const f = folders.find((x) => x.id === cursor);
      if (!f) break;
      trail.unshift({ id: f.id, name: f.name });
      cursor = f.parentId;
    }
    trail.unshift({ id: null, name: "All assets" });
    return trail;
  }, [activeFolderId, folders]);

  // Selection helpers — multi-select with optional shift-click range.
  function toggleSelect(id: string, e: React.MouseEvent) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedId) {
        const idx1 = assets.findIndex((a) => a.id === lastClickedId);
        const idx2 = assets.findIndex((a) => a.id === id);
        if (idx1 >= 0 && idx2 >= 0) {
          const [lo, hi] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
          for (let i = lo; i <= hi; i++) next.add(assets[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  }

  function clearSelection() {
    setSelectedAssetIds(new Set());
    setLastClickedId(null);
  }

  function selectAll() {
    setSelectedAssetIds(new Set(assets.map((a) => a.id)));
  }

  // Ctrl/Cmd+A in the asset grid selects everything in the current
  // folder. Esc clears the selection. We listen at window scope but
  // bail out when the focus is inside an input/textarea so we don't
  // hijack the user's typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (e.key === "Escape") {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // selectAll closes over `assets`; we want the latest each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  async function runBulk(action: BulkAssetAction, opts: {
    folderId?: string | null;
    note?: string;
    visibility?: string;
  } = {}) {
    if (selectedAssetIds.size === 0) return;
    if (action === "delete") {
      if (!confirm(`Delete ${selectedAssetIds.size} asset(s)? This cannot be undone.`))
        return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await bulkAssetOp({
        ids: Array.from(selectedAssetIds),
        action,
        ...(opts.folderId !== undefined ? { folderId: opts.folderId } : {}),
        ...(opts.note !== undefined ? { note: opts.note } : {}),
        ...(opts.visibility !== undefined ? { visibility: opts.visibility } : {}),
      });
      if (r.failed.length) {
        setError(`${r.failed.length} of ${r.failed.length + r.succeeded.length} failed.`);
      }
      clearSelection();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-medium text-ink-100">Assets</h1>
          <p className="text-[11px] text-ink-500">
            File-explorer view. Multi-select for bulk move / delete / approval.
            Drag a folder onto the grid to upload a whole directory tree.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={assets.length === 0}
            title="Select all (Ctrl/Cmd+A)"
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Select all
          </button>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="w-56 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </header>

      {error && (
        <p className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-1.5 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="grid flex-1 grid-cols-[260px_1fr] overflow-hidden">
        <FolderRail
          folders={folders}
          activeFolderId={activeFolderId}
          projectId={project?.id ?? null}
          onSelect={(id) => {
            setActiveFolderId(id);
            clearSelection();
          }}
          onChanged={refresh}
        />
        <main className="flex flex-col overflow-hidden bg-ink-950">
          <Breadcrumb
            crumbs={breadcrumb}
            onJump={(id) => {
              setActiveFolderId(id);
              clearSelection();
            }}
          />

          {selectedAssetIds.size > 0 && (
            <BulkBar
              count={selectedAssetIds.size}
              folders={folders}
              activeFolderId={activeFolderId}
              onAction={runBulk}
              onClear={clearSelection}
              busy={busy}
            />
          )}

          <UploadDropzone
            folderId={activeFolderId}
            projectId={project?.id ?? null}
            onUploaded={refresh}
          />

          <AssetGrid
            assets={assets}
            selectedIds={selectedAssetIds}
            onToggle={toggleSelect}
            onChanged={refresh}
            onEdit={(a) => setEditingAsset(a)}
            busy={busy}
          />
        </main>
      </div>

      <ImageEditor
        asset={editingAsset}
        open={editingAsset !== null}
        onClose={() => setEditingAsset(null)}
        projectId={project?.id ?? null}
        onSaved={async () => {
          setEditingAsset(null);
          await refresh();
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Folder rail                                                            */
/* ---------------------------------------------------------------------- */

function FolderRail({
  folders,
  activeFolderId,
  projectId,
  onSelect,
  onChanged,
}: {
  folders: AssetFolder[];
  activeFolderId: string | null;
  projectId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const roots = folders.filter((f) => !f.parentId);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(parentId: string | null) {
    if (!draftName.trim()) return;
    setBusy(true);
    try {
      await createAssetFolder({
        name: draftName.trim(),
        parentId,
        ...(projectId ? { projectId } : {}),
      });
      setDraftName("");
      setCreatingUnder(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex flex-col overflow-hidden border-r border-ink-800 bg-ink-900">
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-[11px] uppercase tracking-wider text-ink-400">
          Folders
        </h2>
        <button
          type="button"
          onClick={() => {
            setCreatingUnder("__root__");
            setDraftName("");
          }}
          title="New folder at root"
          className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-300 hover:bg-accent-500/25"
        >
          + New
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-1">
        <FolderRow
          name="All assets"
          isActive={activeFolderId === null}
          depth={0}
          count={undefined}
          onClick={() => onSelect(null)}
        />
        {creatingUnder === "__root__" && (
          <NewFolderInput
            depth={1}
            value={draftName}
            onChange={setDraftName}
            onSubmit={() => create(null)}
            onCancel={() => setCreatingUnder(null)}
            busy={busy}
          />
        )}
        {roots.map((root) => (
          <FolderTreeNode
            key={root.id}
            folder={root}
            folders={folders}
            depth={1}
            activeFolderId={activeFolderId}
            onSelect={onSelect}
            onChanged={onChanged}
            creatingUnder={creatingUnder}
            setCreatingUnder={setCreatingUnder}
            draftName={draftName}
            setDraftName={setDraftName}
            onCreate={create}
            busy={busy}
          />
        ))}
        {roots.length === 0 && creatingUnder !== "__root__" && (
          <p className="px-3 py-2 text-[10px] text-ink-500">
            No folders yet. Click + New to create one.
          </p>
        )}
      </div>
    </aside>
  );
}

function FolderTreeNode({
  folder,
  folders,
  depth,
  activeFolderId,
  onSelect,
  onChanged,
  creatingUnder,
  setCreatingUnder,
  draftName,
  setDraftName,
  onCreate,
  busy,
}: {
  folder: AssetFolder;
  folders: AssetFolder[];
  depth: number;
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
  creatingUnder: string | null;
  setCreatingUnder: (id: string | null) => void;
  draftName: string;
  setDraftName: (s: string) => void;
  onCreate: (parentId: string | null) => Promise<void>;
  busy: boolean;
}) {
  const children = folders.filter((f) => f.parentId === folder.id);
  const [open, setOpen] = useState(true);

  const ctx = useContextMenu(() => [
    {
      label: "New subfolder",
      onSelect: () => {
        setCreatingUnder(folder.id);
        setDraftName("");
      },
    },
    {
      label: "Rename",
      onSelect: async () => {
        const next = prompt("New folder name", folder.name);
        if (!next || next.trim() === folder.name) return;
        await updateAssetFolder(folder.id, { name: next.trim() });
        await onChanged();
      },
    },
    { separator: true },
    {
      label: "Delete folder",
      danger: true,
      onSelect: async () => {
        if (
          !confirm(
            `Delete "${folder.name}" and all subfolders? Assets inside will be moved to root.`,
          )
        )
          return;
        await deleteAssetFolder(folder.id);
        await onChanged();
      },
    },
  ]);

  return (
    <div onContextMenu={ctx.onContextMenu}>
      <FolderRow
        name={folder.name}
        isActive={activeFolderId === folder.id}
        depth={depth}
        count={folder._count?.assets ?? 0}
        canExpand={children.length > 0}
        expanded={open}
        onToggleExpand={() => setOpen((v) => !v)}
        onClick={() => onSelect(folder.id)}
      />
      {ctx.element}
      {open &&
        children.map((c) => (
          <FolderTreeNode
            key={c.id}
            folder={c}
            folders={folders}
            depth={depth + 1}
            activeFolderId={activeFolderId}
            onSelect={onSelect}
            onChanged={onChanged}
            creatingUnder={creatingUnder}
            setCreatingUnder={setCreatingUnder}
            draftName={draftName}
            setDraftName={setDraftName}
            onCreate={onCreate}
            busy={busy}
          />
        ))}
      {creatingUnder === folder.id && (
        <NewFolderInput
          depth={depth + 1}
          value={draftName}
          onChange={setDraftName}
          onSubmit={() => onCreate(folder.id)}
          onCancel={() => setCreatingUnder(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function FolderRow({
  name,
  isActive,
  depth,
  count,
  canExpand,
  expanded,
  onToggleExpand,
  onClick,
}: {
  name: string;
  isActive: boolean;
  depth: number;
  count: number | undefined;
  canExpand?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs transition-colors",
        isActive
          ? "bg-accent-500/15 text-accent-200"
          : "text-ink-300 hover:bg-ink-800",
      ].join(" ")}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {canExpand ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-ink-500 hover:text-ink-200"
        >
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : (
        <span className="inline-block h-4 w-4 shrink-0" />
      )}
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-ink-500">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7l1.4 1.4h5A1.5 1.5 0 0 1 14 5.9v5.6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5V4.5z" />
        </svg>
      </span>
      <span className="truncate">{name}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] text-ink-500">{count}</span>
      )}
    </button>
  );
}

function NewFolderInput({
  depth,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  depth: number;
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded bg-accent-500/5 px-2 py-1"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="inline-block h-4 w-4 shrink-0" />
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="folder name"
        className="flex-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100"
        disabled={busy}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Breadcrumb + bulk action bar + grid                                    */
/* ---------------------------------------------------------------------- */

function Breadcrumb({
  crumbs,
  onJump,
}: {
  crumbs: Array<{ id: string | null; name: string }>;
  onJump: (id: string | null) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-4 py-2 text-[11px] text-ink-400">
      {crumbs.map((c, i) => (
        <span key={`${i}-${c.id}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink-600">/</span>}
          <button
            type="button"
            onClick={() => onJump(c.id)}
            className={
              i === crumbs.length - 1
                ? "text-ink-100"
                : "text-ink-300 hover:text-ink-100"
            }
          >
            {c.name}
          </button>
        </span>
      ))}
    </div>
  );
}

function BulkBar({
  count,
  folders,
  activeFolderId,
  onAction,
  onClear,
  busy,
}: {
  count: number;
  folders: AssetFolder[];
  activeFolderId: string | null;
  onAction: (
    action: BulkAssetAction,
    opts?: { folderId?: string | null; note?: string; visibility?: string },
  ) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [moveTarget, setMoveTarget] = useState<string>("__root__");
  const moveOptions = folders.filter((f) => f.id !== activeFolderId);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-accent-500/30 bg-accent-500/5 px-4 py-2 text-[11px] text-ink-200">
      <span className="font-medium text-accent-200">{count} selected</span>
      <span className="text-ink-500">·</span>

      <select
        value={moveTarget}
        onChange={(e) => setMoveTarget(e.target.value)}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] text-ink-100"
      >
        <option value="__root__">Move to root</option>
        {moveOptions.map((f) => (
          <option key={f.id} value={f.id}>
            Move to {f.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() =>
          onAction("move", { folderId: moveTarget === "__root__" ? null : moveTarget })
        }
        disabled={busy}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 hover:bg-ink-800"
      >
        Move
      </button>

      <span className="text-ink-500">·</span>

      <button
        type="button"
        onClick={() => onAction("submit")}
        disabled={busy}
        className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-200 hover:bg-amber-500/20"
      >
        Submit
      </button>
      <button
        type="button"
        onClick={() => onAction("approve")}
        disabled={busy}
        className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200 hover:bg-emerald-500/20"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => {
          const note = prompt("Reason for rejection (shown to uploader):") ?? "";
          onAction("reject", { note });
        }}
        disabled={busy}
        className="rounded border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-orange-200 hover:bg-orange-500/20"
      >
        Reject
      </button>

      <span className="text-ink-500">·</span>

      <button
        type="button"
        onClick={() => onAction("delete")}
        disabled={busy}
        className="rounded border border-danger-500/40 bg-danger-500/10 px-2 py-0.5 text-danger-200 hover:bg-danger-500/20"
      >
        Delete
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-ink-500 hover:text-ink-200"
      >
        Clear
      </button>
    </div>
  );
}

function AssetGrid({
  assets,
  selectedIds,
  onToggle,
  onChanged,
  onEdit,
  busy,
}: {
  assets: Asset[];
  selectedIds: Set<string>;
  onToggle: (id: string, e: React.MouseEvent) => void;
  onChanged: () => Promise<void>;
  onEdit: (a: Asset) => void;
  busy: boolean;
}) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-500">
        {busy ? "Loading…" : "No assets here. Drag a file or folder onto the dropzone above."}
      </div>
    );
  }
  return (
    <ul className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {assets.map((a) => (
        <AssetTile
          key={a.id}
          asset={a}
          selected={selectedIds.has(a.id)}
          onToggle={(e) => onToggle(a.id, e)}
          onChanged={onChanged}
          onEdit={() => onEdit(a)}
        />
      ))}
    </ul>
  );
}

function AssetTile({
  asset,
  selected,
  onToggle,
  onChanged,
  onEdit,
}: {
  asset: Asset;
  selected: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");
  const ctx = useContextMenu(() => [
    // "Open in editor" is the headline action — only meaningful for
    // image assets, hidden for fonts / docs / other binary types.
    ...(isImage
      ? [
          {
            label: "Open in editor",
            onSelect: onEdit,
          },
          {
            separator: true as const,
          },
        ]
      : []),
    {
      label: "Submit for approval",
      onSelect: async () => {
        await submitAssetForApproval(asset.id);
        await onChanged();
      },
    },
    {
      label: "Approve",
      onSelect: async () => {
        await approveAsset(asset.id);
        await onChanged();
      },
    },
    {
      label: "Reject",
      onSelect: async () => {
        const note = prompt("Reason:") ?? "";
        await rejectAsset(asset.id, note);
        await onChanged();
      },
    },
    { separator: true },
    {
      label: "Delete",
      danger: true,
      onSelect: async () => {
        if (!confirm(`Delete "${asset.name}"?`)) return;
        await deleteAsset(asset.id);
        await onChanged();
      },
    },
  ]);

  const status = (asset as Asset & { status?: string }).status ?? "draft";
  // `isImage` was declared at the top of the function for the
  // context-menu condition; reuse it here for the preview render.

  return (
    <li onContextMenu={ctx.onContextMenu}>
      <button
        type="button"
        onClick={onToggle}
        className={[
          "flex w-full flex-col gap-1 rounded-lg border p-2 text-left transition-colors",
          selected
            ? "border-accent-500/60 bg-accent-500/10"
            : "border-ink-800 bg-ink-900 hover:border-ink-700",
        ].join(" ")}
      >
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-ink-950">
          {isImage ? (
            <img
              src={assetBlobUrl(asset.id)}
              alt=""
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <span className="text-[10px] text-ink-500">{asset.mimeType}</span>
          )}
          <StatusPill status={status} />
          {selected && (
            <span className="absolute left-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-ink-950">
              ✓
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-ink-200">{asset.name}</p>
        <p className="truncate text-[10px] text-ink-500">
          {asset.type} · {(asset.fileSize / 1024).toFixed(0)} KB
        </p>
      </button>
      {ctx.element}
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "approved") return null; // approved is the default — no pill noise.
  const cls = {
    draft: "bg-ink-700 text-ink-300",
    pending: "bg-amber-500/30 text-amber-200",
    rejected: "bg-danger-500/30 text-danger-200",
  }[status as "draft" | "pending" | "rejected"];
  return (
    <span
      className={`absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Upload dropzone                                                        */
/* ---------------------------------------------------------------------- */

function UploadDropzone({
  folderId,
  projectId,
  onUploaded,
}: {
  folderId: string | null;
  projectId: string | null;
  onUploaded: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [hover, setHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    try {
      // Recreate folder structure for files that came in via
      // webkitdirectory upload — each file's webkitRelativePath
      // looks like "MyArt/cards/heroes/foo.png". We split on "/"
      // and ensure each path segment exists as a folder under the
      // current target.
      const folderCache = new Map<string, string | null>();
      folderCache.set("", folderId);

      let done = 0;
      for (const file of files) {
        const rel = (file as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        let targetFolderId: string | null = folderId;
        if (rel && rel.includes("/")) {
          const segments = rel.split("/").slice(0, -1);
          let pathKey = "";
          let parent: string | null = folderId;
          for (const seg of segments) {
            pathKey = pathKey ? `${pathKey}/${seg}` : seg;
            if (folderCache.has(pathKey)) {
              parent = folderCache.get(pathKey) ?? null;
              continue;
            }
            // Lazy-create the folder if it doesn't exist.
            try {
              const created = await createAssetFolder({
                name: seg,
                parentId: parent,
                ...(projectId ? { projectId } : {}),
              });
              parent = created.id;
              folderCache.set(pathKey, created.id);
            } catch {
              // 409 slug_taken means a sibling with the same slug
              // already exists — best-effort: leave parent as-is.
              parent = folderId;
              folderCache.set(pathKey, folderId);
            }
          }
          targetFolderId = parent;
        }
        await uploadAsset({
          file,
          name: file.name,
          ...(projectId ? { projectId } : {}),
          ...(targetFolderId ? { folderId: targetFolderId } : {}),
        } as Parameters<typeof uploadAsset>[0]);
        done += 1;
        setProgress({ done, total: files.length });
      }
      await onUploaded();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setHover(false);
    const items = e.dataTransfer.items
      ? Array.from(e.dataTransfer.items)
      : null;
    if (items) {
      // Try the directory-walk path first (Chromium's webkitGetAsEntry)
      // so dropping a folder doesn't drop only its top-level files.
      const files: File[] = [];
      const walks: Array<Promise<void>> = [];
      for (const item of items) {
        const entry = (item as DataTransferItem & {
          webkitGetAsEntry?: () => unknown;
        }).webkitGetAsEntry?.();
        if (entry) {
          walks.push(walkEntry(entry as FsEntry, "", files));
        } else {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      Promise.all(walks).then(() => void uploadFiles(files));
      return;
    }
    const fallback = Array.from(e.dataTransfer.files ?? []);
    void uploadFiles(fallback);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      className={[
        "shrink-0 border-b px-4 py-3 transition-colors",
        hover
          ? "border-accent-500/60 bg-accent-500/10"
          : "border-ink-800 bg-ink-900",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-400">
        <span>
          Drag files or a folder here to upload
          {folderId ? " into this folder" : " to root"}.
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void uploadFiles(fs);
            e.target.value = "";
          }}
        />
        <input
          ref={dirInputRef}
          type="file"
          multiple
          // @ts-expect-error — webkitdirectory is non-standard but
          // supported across modern browsers; React's typings don't
          // include it.
          webkitdirectory=""
          // Same for Firefox-flavored attribute.
          // @ts-expect-error
          directory=""
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void uploadFiles(fs);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          Choose files
        </button>
        <button
          type="button"
          onClick={() => dirInputRef.current?.click()}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          Choose folder
        </button>
        {progress && (
          <span className="text-[10px] text-ink-500">
            Uploading {progress.done} / {progress.total}…
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Folder walk for drag-and-drop directory upload                         */
/* ---------------------------------------------------------------------- */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FsEntry[]) => void) => void;
  };
}

async function walkEntry(entry: FsEntry, base: string, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file?.(
        (f) => {
          // Glue the relative path so uploadFiles can recreate the
          // folder structure.
          Object.defineProperty(f, "webkitRelativePath", {
            value: base ? `${base}/${entry.name}` : entry.name,
          });
          out.push(f);
          resolve();
        },
        () => resolve(),
      );
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    return new Promise((resolve) => {
      reader.readEntries(async (entries) => {
        for (const child of entries) {
          await walkEntry(child, base ? `${base}/${entry.name}` : entry.name, out);
        }
        resolve();
      });
    });
  }
}
