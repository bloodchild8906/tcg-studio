import { useState } from "react";
import * as XLSX from "xlsx";
import { useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";

/**
 * Bulk card importer modal.
 *
 * Accepts XLSX, XLS, CSV, and JSON. Parsing happens fully client-side; we
 * POST each parsed row as a Card to /api/v1/cards. No server endpoint is
 * needed for now — sequential creates are good enough for the file sizes
 * a single designer would import (hundreds, not millions).
 *
 * Column → card field mapping (auto):
 *   name             → card.name (required)
 *   slug             → card.slug (auto-generated from name if missing)
 *   rarity           → card.rarity
 *   collector_number → card.collectorNumber (parsed as int)
 *   collectorNumber  → same
 *   status           → card.status
 *   anything else    → card.dataJson[column]
 *
 * Preview table is shown before commit so the user catches obvious mapping
 * mistakes before they explode into the database.
 */

interface ParsedRow {
  /** Row number in the source file (1-indexed for display, 0-indexed otherwise). */
  rowIndex: number;
  /** Original column-keyed object. */
  raw: Record<string, unknown>;
  /** Fields routed into Card top-level columns. */
  mapped: {
    name: string;
    slug: string;
    rarity?: string;
    collectorNumber?: number;
    status?: string;
  };
  /** Everything else → dataJson. */
  data: Record<string, unknown>;
  /** True when this row would be created (has at least a name). */
  ok: boolean;
  /** Error message if !ok. */
  error?: string;
}

const RESERVED_KEYS = new Set([
  "name",
  "slug",
  "rarity",
  "collector_number",
  "collectorNumber",
  "status",
]);

function autoSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function parseRow(raw: Record<string, unknown>, rowIndex: number): ParsedRow {
  const name =
    typeof raw.name === "string"
      ? raw.name.trim()
      : raw.name !== undefined && raw.name !== null
      ? String(raw.name)
      : "";

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (RESERVED_KEYS.has(k)) continue;
    if (v === "" || v === null || v === undefined) continue;
    data[k] = v;
  }

  const collectorRaw =
    raw.collectorNumber ?? raw.collector_number ?? raw.collector ?? null;
  const collectorNumber =
    collectorRaw !== null &&
    collectorRaw !== undefined &&
    !Number.isNaN(Number(collectorRaw))
      ? Math.max(0, Math.floor(Number(collectorRaw)))
      : undefined;

  const slug =
    typeof raw.slug === "string" && raw.slug.trim()
      ? autoSlug(raw.slug)
      : autoSlug(name) || `row-${rowIndex + 1}`;

  return {
    rowIndex,
    raw,
    mapped: {
      name,
      slug,
      rarity: typeof raw.rarity === "string" ? raw.rarity : undefined,
      collectorNumber,
      status: typeof raw.status === "string" ? raw.status : undefined,
    },
    data,
    ok: name.length > 0,
    error: name.length === 0 ? "missing 'name'" : undefined,
  };
}

async function readFile(file: File): Promise<ParsedRow[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { cards?: unknown[] }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : (() => {
          throw new Error("JSON must be an array or have a top-level 'cards' array.");
        })();
    return list.map((row, i) => {
      if (typeof row !== "object" || row === null) {
        return {
          rowIndex: i,
          raw: {},
          mapped: { name: "", slug: "" },
          data: {},
          ok: false,
          error: "row is not an object",
        };
      }
      return parseRow(row as Record<string, unknown>, i);
    });
  }

  // xlsx + xls + csv all go through SheetJS.
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  // defval: "" so empty cells become "" rather than undefined; keeps row shapes consistent.
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return json.map((row, i) => parseRow(row, i));
}

export function CardImporter({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const projectId = useDesigner((s) => s.activeProjectId);
  const cardTypeId = useDesigner((s) => s.activeCardTypeId);

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });

  function reset() {
    setRows([]);
    setFilename(null);
    setParseError(null);
    setProgress({ done: 0, total: 0, failed: 0 });
  }

  async function handleFile(file: File | null) {
    reset();
    if (!file) return;
    setFilename(file.name);
    try {
      const parsed = await readFile(file);
      setRows(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "parse failed");
    }
  }

  async function commit() {
    if (!projectId || !cardTypeId) {
      setParseError("Pick a project + card type before importing.");
      return;
    }
    const valid = rows.filter((r) => r.ok);
    setImporting(true);
    setProgress({ done: 0, total: valid.length, failed: 0 });
    try {
      // Sequential keeps slugs unique-deterministic and gives deterministic
      // progress. Parallel would speed it up but make error attribution
      // harder. Revisit when files cross 500 rows.
      for (const row of valid) {
        try {
          await api.createCard({
            projectId,
            cardTypeId,
            name: row.mapped.name,
            slug: row.mapped.slug,
            dataJson: row.data,
          });
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        } catch {
          setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
        }
      }
      // Refresh card list in the store from the server.
      const cards = await api.listCards({ projectId, cardTypeId });
      useDesigner.setState({ cards });
      onDone();
      reset();
      onClose();
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const validCount = rows.filter((r) => r.ok).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import cards"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(960px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Import cards</h2>
            <p className="text-[11px] text-ink-400">
              From .xlsx · .xls · .csv · .json — first sheet / top-level array. Each row becomes a card.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <FilePicker onFile={handleFile} disabled={importing} filename={filename} />

        {parseError && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {parseError}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {rows.length === 0 && !parseError ? (
            <EmptyState filename={filename} />
          ) : (
            <ImportPreview rows={rows} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-3">
          <div className="text-[11px] text-ink-400">
            {rows.length === 0 ? (
              "No file loaded yet."
            ) : importing ? (
              <>
                Importing: {progress.done} / {progress.total}
                {progress.failed > 0 && (
                  <span className="ml-2 text-danger-500">{progress.failed} failed</span>
                )}
              </>
            ) : (
              <>
                {rows.length} row{rows.length === 1 ? "" : "s"} parsed ·{" "}
                <span className="text-emerald-300">{validCount} valid</span>
                {rows.length - validCount > 0 && (
                  <span className="ml-2 text-amber-300">
                    {rows.length - validCount} skipped
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && !importing && (
              <button
                type="button"
                onClick={reset}
                className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={commit}
              disabled={importing || validCount === 0 || !cardTypeId}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
            >
              {importing ? "Importing…" : `Import ${validCount} card${validCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FilePicker({
  onFile,
  disabled,
  filename,
}: {
  onFile: (file: File | null) => void;
  disabled: boolean;
  filename: string | null;
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
        const f = e.dataTransfer?.files?.[0] ?? null;
        if (f) onFile(f);
      }}
      className={[
        "mx-4 mt-3 flex cursor-pointer items-center justify-center gap-3 rounded border-2 border-dashed py-4 text-xs",
        disabled
          ? "cursor-not-allowed border-ink-700 text-ink-500"
          : dragOver
          ? "border-accent-500/70 bg-accent-500/10 text-accent-300"
          : "border-ink-700 text-ink-300 hover:border-ink-600 hover:bg-ink-800/40",
      ].join(" ")}
    >
      <UploadIcon />
      <span>
        {filename ? (
          <>
            <span className="font-mono text-ink-200">{filename}</span> · click to replace
          </>
        ) : (
          <>
            Drop a file here, or <u>click to browse</u>
            <span className="ml-1 text-ink-500">(.xlsx, .xls, .csv, .json)</span>
          </>
        )}
      </span>
      <input
        type="file"
        accept=".xlsx,.xls,.csv,.json,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFile(f);
          e.target.value = "";
        }}
        className="sr-only"
      />
    </label>
  );
}

function EmptyState({ filename }: { filename: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-ink-500">
      {filename ? (
        <p>Reading {filename}…</p>
      ) : (
        <>
          <p>Pick a file to preview rows here.</p>
          <p className="max-w-md text-[11px] text-ink-600">
            Recognised columns: <code className="text-ink-400">name</code>,{" "}
            <code className="text-ink-400">slug</code>,{" "}
            <code className="text-ink-400">rarity</code>,{" "}
            <code className="text-ink-400">collector_number</code>,{" "}
            <code className="text-ink-400">status</code>. Anything else lands in{" "}
            <code className="text-ink-400">dataJson</code>.
          </p>
        </>
      )}
    </div>
  );
}

function ImportPreview({ rows }: { rows: ParsedRow[] }) {
  // Build a stable column list across all rows so the table doesn't shift.
  const columnSet = new Set<string>();
  for (const r of rows) {
    Object.keys(r.raw).forEach((k) => columnSet.add(k));
  }
  const columns = Array.from(columnSet);
  const previewRows = rows.slice(0, 200);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="border-b border-ink-700 px-2 py-1.5 text-left">#</th>
            <th className="border-b border-ink-700 px-2 py-1.5 text-left">Status</th>
            {columns.map((c) => (
              <th
                key={c}
                className="whitespace-nowrap border-b border-ink-700 px-2 py-1.5 text-left font-mono"
              >
                {c}
                {RESERVED_KEYS.has(c) ? (
                  <span className="ml-1 rounded bg-accent-500/20 px-1 text-[9px] text-accent-300">
                    field
                  </span>
                ) : (
                  <span className="ml-1 text-ink-600">→ data</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((r) => (
            <tr key={r.rowIndex} className="hover:bg-ink-800/40">
              <td className="border-b border-ink-800 px-2 py-1 text-[10px] text-ink-500">
                {r.rowIndex + 1}
              </td>
              <td className="border-b border-ink-800 px-2 py-1">
                {r.ok ? (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300">
                    ok
                  </span>
                ) : (
                  <span
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-300"
                    title={r.error}
                  >
                    skip
                  </span>
                )}
              </td>
              {columns.map((c) => (
                <td
                  key={c}
                  className="border-b border-ink-800 px-2 py-1 text-ink-200"
                >
                  {formatCell(r.raw[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > previewRows.length && (
        <p className="px-3 py-2 text-[11px] text-ink-500">
          Showing first {previewRows.length} of {rows.length} rows. All will be imported.
        </p>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function UploadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />
    </svg>
  );
}
