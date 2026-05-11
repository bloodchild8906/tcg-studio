import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { AuditRow } from "@/lib/api";

/**
 * Audit log viewer (sec 41).
 *
 * Lists recent rows in reverse-chronological order. Filter by action
 * prefix; "Load more" pages back through history via the cursor the
 * server emits. Metadata renders as collapsible JSON.
 */
export function AuditLogSection() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function refresh(prefix?: string) {
    setLoading(true);
    try {
      const r = await api.listAuditLog({
        actionPrefix: prefix || undefined,
        limit: 100,
      });
      setRows(r.rows);
      setNextBefore(r.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const r = await api.listAuditLog({
        actionPrefix: filter || undefined,
        before: nextBefore,
        limit: 100,
      });
      setRows((prev) => [...prev, ...r.rows]);
      setNextBefore(r.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink-100">Audit log</h3>
          <p className="text-[11px] text-ink-500">
            Every security- and billing-relevant action that touches this
            tenant. Used for compliance reviews and incident triage.
          </p>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by action prefix (e.g. apikey.)"
          className="h-8 w-64 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 placeholder:text-ink-500"
        />
      </header>

      {loading && rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">
          No audit entries match.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {rows.map((r) => (
            <AuditRowItem key={r.id} row={r} />
          ))}
        </ul>
      )}

      {nextBefore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-3 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const hasMeta =
    row.metadataJson && Object.keys(row.metadataJson).length > 0;
  return (
    <li className="px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <code className="font-mono text-[11px] text-accent-300">
              {row.action}
            </code>
            {row.entityType && (
              <span className="text-[10px] text-ink-500">
                {row.entityType}
                {row.entityId ? ` · ${row.entityId.slice(0, 8)}…` : ""}
              </span>
            )}
          </p>
          <p className="text-[11px] text-ink-500">
            {new Date(row.createdAt).toLocaleString()}
            {row.actorUserId && (
              <>
                {" · actor "}
                <code className="font-mono">
                  {row.actorUserId.slice(0, 8)}…
                </code>
              </>
            )}
            {row.ipAddress && ` · ${row.ipAddress}`}
          </p>
        </div>
        {hasMeta && (
          <span className="text-ink-500">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && hasMeta && (
        <pre className="mt-1.5 overflow-auto rounded border border-ink-800 bg-ink-950 p-2 font-mono text-[10px] text-ink-300">
          {JSON.stringify(row.metadataJson, null, 2)}
        </pre>
      )}
    </li>
  );
}
