import { useCallback, useEffect, useRef, useState } from "react";
import { useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";

/**
 * Asset picker modal.
 *
 * Loads assets for the active project on open, lets the user pick or upload.
 * Calls `onPick(asset)` when a tile is clicked, then closes.
 *
 * Why a modal and not an inline panel: the Inspector is already information-
 * dense, and choosing art is a "quick excursion" not an ongoing edit. Modals
 * also let us drop a giant drop-zone target without re-laying-out the panel.
 *
 * Closing rules:
 *   • Escape key → cancel.
 *   • Click on the dim backdrop → cancel.
 *   • Click "Done" or pick a tile → close (with onPick if applicable).
 *
 * v0 limitations: no rename, no thumbnail caching, no multi-select. Filename
 * collisions are tolerated — we let MinIO have N entries with the same name
 * since the underlying ids are unique.
 */
export function AssetPicker({
  open,
  projectId,
  onPick,
  onClose,
}: {
  open: boolean;
  projectId: string | null;
  onPick: (asset: Asset) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const a = await api.listAssets({ projectId });
      setAssets(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Refresh whenever the modal opens; close events are handled by `open`.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !projectId) return;
    setUploading(true);
    setError(null);
    try {
      // Sequential uploads keep ordering deterministic and surface errors clearly.
      // For multi-file uploads we'd batch, but the picker only allows one at a
      // time today.
      for (const file of Array.from(files)) {
        await api.uploadAsset({ file, projectId, type: "art" });
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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Asset library"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        // Click on the backdrop closes; clicks inside the panel do not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(900px,90vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Asset library</h2>
            <p className="text-[11px] text-ink-400">
              {projectId
                ? "Pick an existing asset or drop a new one in."
                : "Open a project before adding assets."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!projectId || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800"
            >
              Close
            </button>
          </div>
        </header>

        <DropZone
          disabled={!projectId || uploading}
          onFiles={handleFiles}
          fileInputRef={fileInputRef}
        />

        {error && (
          <div className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <CenterMessage>Loading…</CenterMessage>
          ) : assets.length === 0 ? (
            <CenterMessage>
              {projectId ? "No assets yet. Drop a file above to get started." : "Select a project first."}
            </CenterMessage>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {assets.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  onPick={() => {
                    onPick(asset);
                    onClose();
                  }}
                  onDelete={() => handleDelete(asset)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DropZone({
  onFiles,
  fileInputRef,
  disabled,
}: {
  onFiles: (files: FileList | null) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  disabled: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        onFiles(e.dataTransfer?.files ?? null);
      }}
      className={[
        "mx-3 mt-3 flex cursor-pointer items-center justify-center gap-3 rounded border-2 border-dashed py-4 text-xs transition-colors",
        disabled
          ? "cursor-not-allowed border-ink-700 text-ink-500"
          : dragOver
          ? "border-accent-500/70 bg-accent-500/10 text-accent-300"
          : "border-ink-700 text-ink-300 hover:border-ink-600 hover:bg-ink-800/40",
      ].join(" ")}
    >
      <UploadIcon />
      <span>
        Drop image here, or <u>click to browse</u>{" "}
        <span className="text-ink-500">(png, jpg, webp, svg, gif — up to 25 MiB)</span>
      </span>
      <input
        ref={fileInputRef}
        type="file"
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
  onPick,
  onDelete,
}: {
  asset: Asset;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group relative overflow-hidden rounded border border-ink-700 bg-ink-800 hover:border-accent-500/40">
      <button
        type="button"
        onClick={onPick}
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
        <div className="space-y-0.5 px-2 py-1.5">
          <p className="truncate text-xs text-ink-100" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-[10px] text-ink-400">
            {asset.mimeType.replace("image/", "")} · {formatBytes(asset.fileSize)}
          </p>
        </div>
      </button>
      <button
        type="button"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded bg-ink-900/80 text-ink-300 opacity-0 hover:bg-danger-500/30 hover:text-danger-500 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-ink-400">{children}</div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
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

/* ---------------------------------------------------------------------- */
/* Hook for components that just need to open it                          */
/* ---------------------------------------------------------------------- */

/**
 * Tiny convenience hook: keeps modal open/close + active project bound.
 * Components consume it like:
 *
 *   const picker = useAssetPicker((asset) => updateLayer(id, { assetId: asset.id, src: assetBlobUrl(asset.id) }));
 *   return (
 *     <>
 *       <button onClick={picker.open}>Pick…</button>
 *       {picker.element}
 *     </>
 *   );
 */
export function useAssetPicker(onPick: (asset: Asset) => void) {
  const [open, setOpen] = useState(false);
  const projectId = useDesigner((s) => s.activeProjectId);
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: open,
    element: (
      <AssetPicker
        open={open}
        projectId={projectId}
        onPick={onPick}
        onClose={() => setOpen(false)}
      />
    ),
  };
}
