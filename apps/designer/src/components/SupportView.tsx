/**
 * Support tickets view (sec 8). Shows three things:
 *
 *   1. Outgoing — tickets I've filed. Open one to see the thread,
 *      add a reply, or watch it move through the status flow.
 *   2. Incoming — tickets routed to my level. Tenant admins see
 *      tickets their project users filed; platform admins see the
 *      queue of tenant-submitted tickets at the platform host.
 *   3. New ticket — submit form. The route ("send to your tenant
 *      admins" / "send to platform support") is computed server-
 *      side from the host the user is on:
 *        - project scope → tenant admins
 *        - tenant scope  → platform support
 *
 * The user explicitly asked for support to be "show requests, and a
 * submit support request that sends to its parent". This view is
 * that — the parent routing is enforced on the API side.
 */

import { useCallback, useEffect, useState } from "react";
import { selectNavLevel, useDesigner } from "@/store/designerStore";
import { request as apiRequest } from "@/lib/api";

interface TicketRow {
  id: string;
  scope: "project" | "tenant" | "platform";
  routedTo: "tenant" | "platform";
  subject: string;
  body: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  category: string | null;
  submitterId: string;
  tenantId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { replies: number };
}

interface TicketReply {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: "submitter" | "responder";
  body: string;
  createdAt: string;
}

export function SupportView() {
  const navLevel = useDesigner(selectNavLevel);
  const [tab, setTab] = useState<"outgoing" | "incoming" | "new">("outgoing");
  const [outgoing, setOutgoing] = useState<TicketRow[]>([]);
  const [incoming, setIncoming] = useState<TicketRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [out, inc] = await Promise.all([
        apiRequest<{ tickets: TicketRow[] }>("/api/v1/support/tickets/outgoing").then(
          (r) => r.tickets,
        ),
        apiRequest<{ tickets: TicketRow[] }>("/api/v1/support/tickets/incoming").then(
          (r) => r.tickets,
        ),
      ]);
      setOutgoing(out);
      setIncoming(inc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const parentLabel =
    navLevel === "project"
      ? "your tenant admins"
      : navLevel === "tenant"
        ? "platform support"
        : "internal";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-medium text-ink-100">Support</h1>
          <p className="text-[11px] text-ink-500">
            Submit a ticket — it routes to{" "}
            <strong className="text-ink-300">{parentLabel}</strong>. Track its
            status here, reply on the thread, and close it when resolved.
          </p>
        </div>
        <nav className="flex gap-1 rounded border border-ink-800 bg-ink-950 p-1 text-xs">
          {(["outgoing", "incoming", "new"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={[
                "rounded px-3 py-1 transition-colors",
                tab === k
                  ? "bg-accent-500/20 text-accent-200"
                  : "text-ink-400 hover:text-ink-200",
              ].join(" ")}
            >
              {k === "outgoing"
                ? `Outgoing (${outgoing.length})`
                : k === "incoming"
                  ? `Incoming (${incoming.length})`
                  : "+ New ticket"}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <p className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-2 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === "outgoing" && (
          <TicketList
            tickets={outgoing}
            emptyHint="You haven't filed any support tickets yet."
            onOpen={(id) => setOpenId(id)}
          />
        )}
        {tab === "incoming" && (
          <TicketList
            tickets={incoming}
            emptyHint="No tickets are waiting for your level. Quiet times."
            onOpen={(id) => setOpenId(id)}
          />
        )}
        {tab === "new" && (
          <NewTicketForm
            parentLabel={parentLabel}
            onCreated={async () => {
              await refresh();
              setTab("outgoing");
            }}
          />
        )}
      </div>

      {openId && (
        <TicketDetail
          ticketId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function TicketList({
  tickets,
  emptyHint,
  onOpen,
}: {
  tickets: TicketRow[];
  emptyHint: string;
  onOpen: (id: string) => void;
}) {
  if (tickets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-500">
        {emptyHint}
      </div>
    );
  }
  return (
    <ul className="h-full divide-y divide-ink-800 overflow-y-auto bg-ink-950">
      {tickets.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-900"
          >
            <StatusDot status={t.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-medium text-ink-100">
                  {t.subject}
                </p>
                <span className="shrink-0 text-[10px] text-ink-500">
                  {new Date(t.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-500">
                <PriorityChip priority={t.priority} />
                <span>·</span>
                <span className="font-mono">{t.scope} → {t.routedTo}</span>
                {t._count && t._count.replies > 0 && (
                  <>
                    <span>·</span>
                    <span>{t._count.replies} reply</span>
                  </>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">{t.body}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NewTicketForm({
  parentLabel,
  onCreated,
}: {
  parentLabel: string;
  onCreated: () => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">(
    "normal",
  );
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/v1/support/tickets", {
        method: "POST",
        body: {
          subject: subject.trim(),
          body: body.trim(),
          priority,
          category: category.trim() || undefined,
        },
      });
      setSubject("");
      setBody("");
      setCategory("");
      setPriority("normal");
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto h-full max-w-2xl space-y-3 overflow-y-auto p-6"
    >
      <p className="rounded border border-accent-500/30 bg-accent-500/5 px-3 py-2 text-[11px] text-ink-300">
        This ticket will be routed to{" "}
        <strong className="text-accent-300">{parentLabel}</strong>. They'll get
        a notification and can reply on the thread.
      </p>

      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">
          Subject
        </span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary of the issue"
          maxLength={200}
          className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          required
        />
      </label>

      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">
          Description
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="Steps to reproduce, what you expected, what actually happened…"
          className="mt-1 block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-ink-400">
            Priority
          </span>
          <select
            value={priority}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "low" || v === "normal" || v === "high" || v === "urgent")
                setPriority(v);
            }}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-ink-400">
            Category (optional)
          </span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="bug, billing, feature…"
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          />
        </label>
      </div>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={busy || !subject.trim() || !body.trim()}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-4 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Submitting…" : "Submit ticket"}
        </button>
      </div>
    </form>
  );
}

function TicketDetail({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = useDesigner((s) => s.currentUser?.id);

  useEffect(() => {
    void (async () => {
      try {
        const r = await apiRequest<{
          ticket: TicketRow & { replies: TicketReply[] };
        }>(`/api/v1/support/tickets/${ticketId}`);
        setTicket(r.ticket);
        setReplies(r.ticket.replies ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "load failed");
      }
    })();
  }, [ticketId]);

  async function postReply() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest<{ reply: TicketReply }>(
        `/api/v1/support/tickets/${ticketId}/replies`,
        { method: "POST", body: { body: draft.trim() } },
      );
      setReplies((prev) => [...prev, r.reply]);
      setDraft("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "reply failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: TicketRow["status"]) {
    if (!ticket) return;
    try {
      const r = await apiRequest<{ ticket: TicketRow }>(
        `/api/v1/support/tickets/${ticketId}`,
        { method: "PATCH", body: { status } },
      );
      setTicket(r.ticket);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    }
  }

  if (!ticket) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
        <div className="rounded bg-ink-900 p-4 text-xs text-ink-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-end bg-black/40">
      <div className="flex w-full max-w-xl flex-col overflow-hidden bg-ink-950 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              {ticket.scope} → {ticket.routedTo}
            </p>
            <h2 className="text-sm font-semibold text-ink-100">
              {ticket.subject}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <StatusDot status={ticket.status} />
              <span className="text-[10px] text-ink-400">{ticket.status}</span>
              <PriorityChip priority={ticket.priority} />
              {ticket.category && (
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                  {ticket.category}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-ink-500 hover:text-ink-200"
          >
            ×
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Bubble
            authorRole="submitter"
            isMine={ticket.submitterId === currentUserId}
            body={ticket.body}
            createdAt={ticket.createdAt}
          />
          {replies.map((r) => (
            <Bubble
              key={r.id}
              authorRole={r.authorRole}
              isMine={r.authorId === currentUserId}
              body={r.body}
              createdAt={r.createdAt}
            />
          ))}
        </div>

        {error && (
          <p className="border-t border-danger-500/30 bg-danger-500/10 px-4 py-2 text-[11px] text-danger-400">
            {error}
          </p>
        )}

        <footer className="border-t border-ink-800 bg-ink-900 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a reply…"
            className="block w-full resize-none rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {ticket.status !== "resolved" && (
                <button
                  type="button"
                  onClick={() => void setStatus("resolved")}
                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                >
                  Mark resolved
                </button>
              )}
              {ticket.status !== "closed" && (
                <button
                  type="button"
                  onClick={() => void setStatus("closed")}
                  className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-800"
                >
                  Close
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={postReply}
              disabled={busy || !draft.trim()}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send reply"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Bubble({
  authorRole,
  isMine,
  body,
  createdAt,
}: {
  authorRole: "submitter" | "responder";
  isMine: boolean;
  body: string;
  createdAt: string;
}) {
  const align = isMine ? "items-end" : "items-start";
  const tone =
    authorRole === "responder"
      ? "border-violet-500/30 bg-violet-500/5"
      : "border-ink-800 bg-ink-900";
  return (
    <div className={`flex flex-col gap-1 ${align}`}>
      <div
        className={`max-w-[85%] rounded-lg border px-3 py-2 text-xs text-ink-100 ${tone}`}
      >
        {body.split("\n").map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </div>
      <span className="text-[9px] text-ink-500">
        {authorRole} · {new Date(createdAt).toLocaleString()}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: TicketRow["status"] }) {
  const cls = {
    open: "bg-amber-400",
    in_progress: "bg-sky-400",
    resolved: "bg-emerald-400",
    closed: "bg-ink-600",
  }[status];
  return <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function PriorityChip({ priority }: { priority: TicketRow["priority"] }) {
  const tone = {
    low: "text-ink-400 border-ink-700",
    normal: "text-ink-300 border-ink-700",
    high: "text-amber-300 border-amber-500/40",
    urgent: "text-danger-300 border-danger-500/40",
  }[priority];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${tone}`}
    >
      {priority}
    </span>
  );
}
