import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { TaskPriority, TaskStatus, TenantTaskRow } from "@/lib/api";
import { useDesigner } from "@/store/designerStore";

/**
 * Tenant-scoped tasks view (kanban).
 *
 * Four columns: Todo / In Progress / Review / Done. HTML5 drag and
 * drop moves tasks between columns. Clicking a card opens a side
 * panel for full editing. New-task button at the top of each column.
 *
 * Filters: assignee dropdown (everyone / just me) + project filter
 * (active project only / all). Project-level hosts auto-filter to
 * the active project; tenant-level hosts default to "all projects".
 */
export function TasksView() {
  const activeProjectId = useDesigner((s) => s.activeProjectId);
  const navLevel = useDesigner((s) =>
    s.hostContext?.level === "project" ? "project" : "tenant",
  );
  const currentUser = useDesigner((s) => s.currentUser);

  const [tasks, setTasks] = useState<TenantTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"active" | "all">(
    navLevel === "project" ? "active" : "all",
  );
  const [assignee, setAssignee] = useState<"any" | "me">("any");
  const [editing, setEditing] = useState<TenantTaskRow | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof api.listTenantTasks>[0] = {};
      if (scope === "active" && activeProjectId) params.projectId = activeProjectId;
      if (assignee === "me" && currentUser) params.assigneeId = currentUser.id;
      setTasks(await api.listTenantTasks(params));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, assignee, activeProjectId]);

  const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
    { status: "todo", label: "To do" },
    { status: "in_progress", label: "In progress" },
    { status: "review", label: "Review" },
    { status: "done", label: "Done" },
  ];

  async function moveTask(id: string, status: TaskStatus) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.updateTenantTask(id, { status });
    } catch {
      await refresh();
    }
  }

  async function createTask(status: TaskStatus) {
    const title = window.prompt(`New ${status} task — title?`);
    if (!title || !title.trim()) return;
    const created = await api.createTenantTask({
      title: title.trim(),
      status,
      projectId:
        scope === "active" && activeProjectId ? activeProjectId : undefined,
    });
    setTasks((prev) => [created, ...prev]);
  }

  async function destroy(t: TenantTaskRow) {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    await api.deleteTenantTask(t.id);
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-950">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Collaboration
          </p>
          <h1 className="mt-0.5 text-lg font-semibold text-ink-50">Tasks</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value as "any" | "me")}
            className="h-8 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100"
          >
            <option value="any">Everyone</option>
            <option value="me">Just me</option>
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "active" | "all")}
            className="h-8 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100"
            disabled={!activeProjectId}
          >
            <option value="all">All projects</option>
            <option value="active">Active project only</option>
          </select>
        </div>
      </header>

      {error && (
        <p className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-400">
          {error}
        </p>
      )}

      <div className="grid flex-1 grid-cols-4 gap-3 overflow-hidden p-3">
        {COLUMNS.map((col) => {
          const colTasks = tasks
            .filter((t) => t.status === col.status)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return (
            <Column
              key={col.status}
              label={col.label}
              count={colTasks.length}
              loading={loading}
              onAdd={() => createTask(col.status)}
              onDrop={(taskId) => moveTask(taskId, col.status)}
            >
              {colTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onEdit={() => setEditing(t)}
                  onDelete={() => destroy(t)}
                />
              ))}
            </Column>
          );
        })}
      </div>

      {editing && (
        <TaskEditModal
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setTasks((prev) =>
              prev.map((x) => (x.id === updated.id ? updated : x)),
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Column({
  label,
  count,
  loading,
  onAdd,
  onDrop,
  children,
}: {
  label: string;
  count: number;
  loading: boolean;
  onAdd: () => void;
  onDrop: (taskId: string) => void;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <section
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-tcgs-task")) {
          e.preventDefault();
          setHover(true);
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("application/x-tcgs-task");
        setHover(false);
        if (id) onDrop(id);
      }}
      className={[
        "flex min-h-0 flex-col rounded-lg border bg-ink-900 transition-colors",
        hover ? "border-accent-500/60 bg-accent-500/5" : "border-ink-800",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-300">
          {label} <span className="text-ink-500">({count})</span>
        </h3>
        <button
          type="button"
          onClick={onAdd}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
        >
          + New
        </button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {loading && count === 0 && (
          <p className="py-3 text-center text-[11px] text-ink-500">Loading…</p>
        )}
        {children}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  onEdit,
  onDelete,
}: {
  task: TenantTaskRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-tcgs-task", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onEdit}
      className="cursor-pointer rounded border border-ink-800 bg-ink-950 p-2 hover:border-accent-500/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-100">{task.title}</p>
        <PriorityChip p={task.priority} />
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">
          {task.description}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
        <span>
          {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded px-1 text-ink-500 hover:bg-danger-500/15 hover:text-danger-400"
          title="Delete"
        >
          ×
        </button>
      </div>
    </article>
  );
}

function PriorityChip({ p }: { p: TaskPriority }) {
  const palette: Record<TaskPriority, string> = {
    low: "bg-ink-700 text-ink-400",
    normal: "bg-ink-700 text-ink-300",
    high: "bg-amber-500/20 text-amber-300",
    urgent: "bg-danger-500/20 text-danger-300",
  };
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px text-[9px] uppercase tracking-wider ${palette[p]}`}
    >
      {p}
    </span>
  );
}

function TaskEditModal({
  task,
  onClose,
  onSaved,
}: {
  task: TenantTaskRow;
  onClose: () => void;
  onSaved: (updated: TenantTaskRow) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState(task.dueAt ? task.dueAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await api.updateTenantTask(task.id, {
        title,
        description,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onSaved(updated);
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
      <div className="w-[520px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <h3 className="mb-4 text-base font-medium text-ink-100">Edit task</h3>
        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            rows={5}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-400">
              Priority
            </span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
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
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
