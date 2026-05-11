import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { JobRow, JobStatus } from "@/lib/api";

/**
 * Background jobs panel (sec 38).
 *
 * Surfaces the tenant's recent job rows: status chips, attempts vs
 * maxAttempts, last error preview, and per-row retry/cancel actions.
 * Polls every 4s while the panel is mounted so running jobs visibly
 * progress.
 *
 * "Run snapshot" enqueues a `tenant.snapshot` job — a quick smoke
 * test that exercises the whole worker pipeline and returns counts
 * of cards/assets/projects/pages so operators can confirm the worker
 * is healthy.
 */
export function JobsSection() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.listJobs({
        status: filter === "all" ? undefined : filter,
        limit: 100,
      });
      setJobs(r.jobs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Poll while the panel is mounted so running jobs animate. 4s is
    // a fine cadence — fast enough for "is it done yet" feedback,
    // slow enough that idle tabs aren't a load problem.
    const i = window.setInterval(refresh, 4000);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function snapshot() {
    setBusy(true);
    try {
      await api.enqueueJob({ type: "tenant.snapshot" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function retry(j: JobRow) {
    await api.retryJob(j.id);
    await refresh();
  }
  async function cancel(j: JobRow) {
    await api.cancelJob(j.id);
    await refresh();
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink-100">Background jobs</h3>
          <p className="text-[11px] text-ink-500">
            Long-running operations the API queues for the worker — PDF
            renders, scheduled publishes, webhook replays.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as JobStatus | "all")}
            className="h-8 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100"
          >
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            type="button"
            onClick={snapshot}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            title="Enqueue a tenant.snapshot job to test the worker"
          >
            {busy ? "…" : "Run snapshot"}
          </button>
        </div>
      </header>

      {loading && jobs.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">
          No background jobs in this filter.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {jobs.map((j) => {
            const expanded = expandedId === j.id;
            const progress =
              ((j.payloadJson?.progress as { pct?: number; message?: string }) ??
              null);
            return (
              <li key={j.id} className="px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : j.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <code className="font-mono text-[11px] text-accent-300">
                        {j.type}
                      </code>
                      <StatusChip status={j.status} />
                      {j.attempts > 0 && (
                        <span className="text-[10px] text-ink-500">
                          attempt {j.attempts}/{j.maxAttempts}
                        </span>
                      )}
                    </p>
                    {progress?.message && (
                      <p className="mt-0.5 text-[11px] text-ink-300">
                        {progress.message}
                        {typeof progress.pct === "number" && ` · ${progress.pct}%`}
                      </p>
                    )}
                    {j.status === "running" && progress?.pct != null && (
                      <div className="mt-1 h-1 overflow-hidden rounded bg-ink-800">
                        <div
                          className="h-full bg-accent-500 transition-all"
                          style={{ width: `${progress.pct ?? 0}%` }}
                        />
                      </div>
                    )}
                    {j.lastError && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-danger-400">
                        {j.lastError}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-ink-500">
                      Created {new Date(j.createdAt).toLocaleString()}
                      {j.completedAt &&
                        ` · finished ${new Date(j.completedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(j.status === "queued" || j.status === "running") && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void cancel(j);
                        }}
                        className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-700"
                      >
                        Cancel
                      </button>
                    )}
                    {(j.status === "failed" || j.status === "cancelled") && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void retry(j);
                        }}
                        className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </button>
                {expanded && (
                  <pre className="mt-2 overflow-auto rounded border border-ink-800 bg-ink-950 p-2 font-mono text-[10px] text-ink-300">
                    {JSON.stringify(
                      {
                        payload: j.payloadJson,
                        result: j.resultJson,
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: JobStatus }) {
  const palette: Record<JobStatus, string> = {
    queued: "bg-ink-700 text-ink-300",
    running: "bg-accent-500/20 text-accent-300",
    completed: "bg-emerald-500/20 text-emerald-300",
    failed: "bg-danger-500/20 text-danger-300",
    cancelled: "bg-ink-700 text-ink-500",
  };
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${palette[status]}`}
    >
      {status}
    </span>
  );
}
