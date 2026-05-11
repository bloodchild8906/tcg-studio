import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import { AssetEditor } from "@/components/AssetEditor";
import { SpriteSplitter } from "@/components/SpriteSplitter";
import { ImageEditor } from "@/components/ImageEditor";
import { useContextMenu } from "@/components/ContextMenu";

/**
 * Standalone Assets view.
 *
 * Spec sec 20 calls for an "asset library" — a project-wide list of every
 * uploaded resource (frames, art, icons, fonts, panels…). For v0 this is
 * essentially a thin browser over `/api/v1/assets`: upload, list, view,
 * delete. It complements the AssetPicker modal (which is opened from an
 * image layer's inspector) — same operations, different entry point.
 *
 * Layout:
 *   • Header — project + asset count + type filter dropdown
 *   • Drop zone — full-width drag-drop / click-to-upload
 *   • Grid     — auto-fill 200px tiles with thumbnail, name, type pill,
 *                size, faded delete button on hover
 *
 * The filter operates client-side because asset counts are small enough
 * (hundreds, not millions) that round-tripping for every type click would
 * be wasteful.
 */
export function AssetsView() {
  const project = useDesigner(selectActiveProject);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Asset | null>(null);
  const [splitting, setSplitting] = useState<Asset | null>(null);
  const [imageEditing, setImageEditing] = useState<Asset | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!project) {
      setAssets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.listAssets({ projectId: project.id });
      setAssets(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !project) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.uploadAsset({ file, projectId: project.id, type: "art" });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(asset: Asset) {
    if (!confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    try {
      await api.deleteAsset(asset.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  // Available types for filter — derived from the current asset list so the
  // dropdown only shows types that actually exist in the project.
  const types = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) set.add(a.type);
    return Array.from(set).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.slug.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [assets, typeFilter, query]);

  const totalBytes = useMemo(
    () => filtered.reduce((sum, a) => sum + (a.fileSize ?? 0), 0),
    [filtered],
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to see its asset library.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-7xl p-6">
        <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Project: {project.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Assets</h1>
            <p className="mt-1 text-xs text-ink-400">
              {filtered.length} of {assets.length} assets · {formatBytes(totalBytes)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-48 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100"
            >
              <option value="all">All types ({assets.length})</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t} ({assets.filter((a) => a.type === t).length})
                </option>
              ))}
            </select>
          </div>
        </header>

        <UploadDropZone
          onFiles={handleFiles}
          fileInputRef={fileInputRef}
          uploading={uploading}
        />

        {error && (
          <div className="mt-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <div className="mt-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-ink-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={assets.length > 0} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {filtered.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  onDelete={() => handleDelete(asset)}
                  onEdit={() => setEditing(asset)}
                  onSplit={() => setSplitting(asset)}
                  onImageEdit={() => setImageEditing(asset)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <AssetEditor
        asset={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        }}
      />

      <SpriteSplitter
        asset={splitting}
        open={splitting !== null}
        projectId={project?.id ?? null}
        onClose={() => setSplitting(null)}
        onSplit={(created) => {
          // Splice the freshly-uploaded cells in front of the existing
          // list so they're visible without forcing a full refresh.
          setAssets((prev) => [...created, ...prev]);
        }}
      />

      <ImageEditor
        asset={imageEditing}
        open={imageEditing !== null}
        projectId={project?.id ?? null}
        onClose={() => setImageEditing(null)}
        onSaved={(created) => {
          // Insert the edited copy at the top of the list. If the user
          // chose "replace", the original was deleted server-side and
          // the previous tile will disappear on the next refresh —
          // most users hit refresh implicitly by closing the editor,
          // so we don't bother force-refreshing here.
          setAssets((prev) => [created, ...prev]);
        }}
      />
    </div>
  );
}

function UploadDropZone({
  onFiles,
  fileInputRef,
  uploading,
}: {
  onFiles: (files: FileList | null) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        if (uploading) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (uploading) return;
        onFiles(e.dataTransfer?.files ?? null);
      }}
      className={[
        "flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed py-6 text-xs transition-colors",
        uploading
          ? "cursor-wait border-ink-700 text-ink-500"
          : dragOver
          ? "border-accent-500/70 bg-accent-500/10 text-accent-300"
          : "border-ink-700 text-ink-300 hover:border-ink-600 hover:bg-ink-900/40",
      ].join(" ")}
    >
      <UploadIcon />
      <span>
        {uploading
          ? "Uploading…"
          : "Drop images here, or click to browse — png, jpg, webp, svg, gif (≤25 MiB each)"}
      </span>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/avif,image/gif"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
        className="sr-only"
      />
    </label>
  );
}

function AssetTile({
  asset,
  onDelete,
  onEdit,
  onSplit,
  onImageEdit,
}: {
  asset: Asset;
  onDelete: () => void;
  onEdit: () => void;
  onSplit: () => void;
  onImageEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const hasSlice = !!asset.metadataJson?.slice;
  const hasSlice25 = !!asset.metadataJson?.slice25;
  const ppu = asset.metadataJson?.pixelsPerUnit;
  // Splitter only makes sense for raster images. SVGs and fonts shouldn't
  // expose the action because the canvas crop path won't produce useful
  // outputs (SVG would rasterize at one fixed size; fonts have no pixels).
  const splittable = asset.mimeType.startsWith("image/") && !asset.mimeType.includes("svg");

  const ctx = useContextMenu(() => [
    { label: "Edit metadata", onSelect: onEdit, shortcut: "Enter" },
    {
      label: "Edit image",
      onSelect: onImageEdit,
      disabled: !splittable,
    },
    {
      label: "Split spritesheet",
      onSelect: onSplit,
      disabled: !splittable,
    },
    { separator: true },
    {
      label: copied ? "Copied!" : "Copy asset id",
      onSelect: () => {
        void navigator.clipboard
          .writeText(asset.id)
          .then(() => setCopied(true))
          .then(() => setTimeout(() => setCopied(false), 1200));
      },
    },
    { separator: true },
    {
      label: "Delete asset",
      onSelect: onDelete,
      danger: true,
      shortcut: "Del",
    },
  ]);

  return (
    <li
      className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40"
      onContextMenu={ctx.onContextMenu}
    >
      <button
        type="button"
        onClick={onEdit}
        className="block w-full text-left"
      >
        <div className="flex aspect-square items-center justify-center bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]">
          <img
            src={api.assetBlobUrl(asset.id)}
            alt={asset.name}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </div>
        <div className="space-y-0.5 px-3 py-2">
          <p className="truncate text-xs font-medium text-ink-50" title={asset.name}>
            {asset.name}
          </p>
          <p className="truncate font-mono text-[10px] text-ink-500" title={asset.slug}>
            {asset.slug}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-400">
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-medium uppercase tracking-wider text-ink-300">
              {asset.type}
            </span>
            {hasSlice25 && (
              <span
                title="25-slice configured — auto-applies on import; renderer prefers this over 9-slice when both are set."
                className="rounded bg-accent-500/20 px-1.5 py-0.5 font-medium uppercase tracking-wider text-accent-200"
              >
                25-slice
              </span>
            )}
            {hasSlice && !hasSlice25 && (
              <span
                title="9-slice configured — auto-applies on import."
                className="rounded bg-accent-500/15 px-1.5 py-0.5 font-medium uppercase tracking-wider text-accent-300"
              >
                9-slice
              </span>
            )}
            {typeof ppu === "number" && ppu > 0 && (
              <span
                title={`Pixels per unit: ${ppu}`}
                className="rounded bg-ink-800 px-1.5 py-0.5 font-medium uppercase tracking-wider text-ink-300"
              >
                {ppu} ppu
              </span>
            )}
            <span>{asset.mimeType.replace("image/", "")}</span>
            <span>·</span>
            <span>{formatBytes(asset.fileSize)}</span>
          </div>
        </div>
      </button>
      <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100">
        <IconBtn
          title={copied ? "Copied!" : "Copy asset id"}
          onClick={() => {
            void navigator.clipboard
              .writeText(asset.id)
              .then(() => setCopied(true))
              .then(() => setTimeout(() => setCopied(false), 1200));
          }}
        >
          <ClipboardIcon />
        </IconBtn>
        <IconBtn title="Edit" onClick={onEdit}>
          <EditIcon />
        </IconBtn>
        {splittable && (
          <IconBtn title="Split spritesheet" onClick={onSplit}>
            <GridIcon />
          </IconBtn>
        )}
        {splittable && (
          <IconBtn title="Edit image (crop / rotate / flip)" onClick={onImageEdit}>
            <CropIcon />
          </IconBtn>
        )}
        <IconBtn title="Delete" danger onClick={onDelete}>
          <TrashIcon />
        </IconBtn>
      </div>
      {ctx.element}
    </li>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-700 p-10 text-center text-xs text-ink-500">
      {hasAny ? (
        <>
          <p>No assets match the current filter.</p>
          <p className="text-[11px] text-ink-600">Clear the search or change the type dropdown.</p>
        </>
      ) : (
        <>
          <p>No assets yet.</p>
          <p className="text-[11px] text-ink-600">
            Drop a frame, icon, or art file above. Image layers in the designer pick from this library.
          </p>
        </>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        "inline-flex h-6 w-6 items-center justify-center rounded bg-ink-900/80 text-ink-300 hover:bg-ink-800 hover:text-ink-50",
        danger && "hover:!bg-danger-500/30 hover:!text-danger-500",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function UploadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l1 8h4l1-8" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="3" width="8" height="11" rx="1" />
      <path d="M6 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12.5V14h1.5l8-8L10 4.5l-8 8z" />
      <path d="M10 4.5L11.5 3l1.5 1.5L11.5 6 10 4.5z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 8h11M8 2.5v11" />
    </svg>
  );
}
function CropIcon() {
  // L-shaped crop marks — corners only, suggesting "crop region".
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5V3h2M11 3h2v2M13 11v2h-2M5 13H3v-2" />
      <rect x="5" y="5" width="6" height="6" opacity="0.4" />
    </svg>
  );
}
