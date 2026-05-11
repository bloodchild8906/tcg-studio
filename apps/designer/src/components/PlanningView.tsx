import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { MilestoneRow, TenantTaskRow } from "@/lib/api";
import { useDesigner, selectActiveProject } from "@/store/designerStore";

/**
 * Project planning view — milestones + roadmap.
 *
 * Project-scoped: every milestone belongs to a project. We derive
 * progress from TenantTask rows attached to the same project +
 * sharing the milestone label (we use the Task labels array for the
 * cheap "task belongs to milestone X" link, since tasks don't have a
 * hard FK to Milestone). Milestones with no tasks just display a
 * date-based progress bar.
 *
 * Layout:
 *   Sticky header — project name + "+ Milestone" button.
 *   Three columns (Upcoming / Active / Done) with cards.
 *   Each card: name, dates, progress bar, edit/delete actions.
 */
export function PlanningView() {
  const project = useDesigner(selectActiveProject);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [tasks, setTasks] = useState<TenantTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MilestoneRow | "new" | null>(null);

  async function refresh() {
    if (!project) {
      setMilestones([]);
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [m, t] = await Promise.all([
        api.listMilestones({ projectId: project.id }),
        api.listTenantTasks({ projectId: project.id }),
      ]);
      setMilestones(m);
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const buckets = useMemo(() => {
    const upcoming = milestones.filter((m) => m.status === "upcoming");
    const active = milestones.filter((m) => m.status === "active");
    const done = milestones.filter(
      (m) => m.status === "done" || m.status === "cancelled",
    );
    return { upcoming, active, done };
  }, [milestones]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">
          Pick a project to see its roadmap.
        </p>
      </div>
    );
  }

  async function destroy(m: MilestoneRow) {
    if (!confirm(`Delete milestone "${m.name}"?`)) return;
    await api.deleteMilestone(m.id);
    await refresh();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-950">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Project · {project.name}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold text-ink-50">
            Planning
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
        >
          + Milestone
        </button>
      </header>

      {error && (
        <p className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-400">
          {error}
        </p>
      )}

      <div className="grid flex-1 grid-cols-3 gap-3 overflow-hidden p-3">
        <Bucket
          label="Upcoming"
          milestones={buckets.upcoming}
          tasks={tasks}
          loading={loading}
          onEdit={(m) => setEditing(m)}
          onDelete={destroy}
        />
        <Bucket
          label="Active"
          milestones={buckets.active}
          tasks={tasks}
          loading={loading}
          onEdit={(m) => setEditing(m)}
          onDelete={destroy}
        />
        <Bucket
          label="Done"
          milestones={buckets.done}
          tasks={tasks}
          loading={loading}
          onEdit={(m) => setEditing(m)}
          onDelete={destroy}
        />
      </div>

      {editing && (
        <MilestoneEditModal
          milestone={editing === "new" ? null : editing}
          projectId={project.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Bucket({
  label,
  milestones,
  tasks,
  loading,
  onEdit,
  onDelete,
}: {
  label: string;
  milestones: MilestoneRow[];
  tasks: TenantTaskRow[];
  loading: boolean;
  onEdit: (m: MilestoneRow) => void;
  onDelete: (m: MilestoneRow) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-ink-800 bg-ink-900">
      <header className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-300">
          {label} <span className="text-ink-500">({milestones.length})</span>
        </h3>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {loading && milestones.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-ink-500">Loading…</p>
        ) : milestones.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-ink-500">
            No milestones in this bucket.
          </p>
        ) : (
          milestones.map((m) => (
            <MilestoneCard
              key={m.id}
              milestone={m}
              tasks={tasks}
              onEdit={() => onEdit(m)}
              onDelete={() => onDelete(m)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MilestoneCard({
  milestone,
  tasks,
  onEdit,
  onDelete,
}: {
  milestone: MilestoneRow;
  tasks: TenantTaskRow[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Tasks tagged with this milestone via the labels array (cheap soft
  // link). The label format `milestone:<id>` is a convention — we can
  // upgrade to a hard FK later if needed.
  const linked = tasks.filter((t) => t.labels?.includes(`milestone:${milestone.id}`));
  const closed = linked.filter((t) => t.status === "done").length;
  const pct = linked.length > 0 ? Math.round((closed / linked.length) * 100) : 0;

  return (
    <article
      onClick={onEdit}
      className="cursor-pointer rounded border border-ink-800 bg-ink-950 p-3 hover:border-accent-500/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-100">{milestone.name}</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded px-1 text-[11px] text-ink-500 hover:bg-danger-500/15 hover:text-danger-400"
          title="Delete"
        >
          ×
        </button>
      </div>
      {milestone.description && (
        <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">
          {milestone.description}
        </p>
      )}
      <div className="mt-2 space-y-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full bg-accent-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="flex items-center justify-between text-[10px] text-ink-500">
          <span>
            {linked.length === 0
              ? "No linked tasks"
              : `${closed}/${linked.length} tasks done · ${pct}%`}
          </span>
          {milestone.dueAt && (
            <span>Due {new Date(milestone.dueAt).toLocaleDateString()}</span>
          )}
        </p>
      </div>
    </article>
  );
}

function MilestoneEditModal({
  milestone,
  projectId,
  onClose,
  onSaved,
}: {
  milestone: MilestoneRow | null;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = !milestone;
  const [name, setName] = useState(milestone?.name ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [status, setStatus] = useState<MilestoneRow["status"]>(
    milestone?.status ?? "upcoming",
  );
  const [dueAt, setDueAt] = useState(
    milestone?.dueAt ? milestone.dueAt.slice(0, 10) : "",
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (isNew) {
        await api.createMilestone({
          projectId,
          name,
          description,
          status,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        });
      } else {
        await api.updateMilestone(milestone!.id, {
          name,
          description,
          status,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        });
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <h3 className="mb-4 text-base font-medium text-ink-100">
          {isNew ? "New milestone" : "Edit milestone"}
        </h3>
        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-400">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MilestoneRow["status"])}
              className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-400">
              Due
            </span>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim()}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
