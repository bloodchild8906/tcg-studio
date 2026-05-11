import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { ChannelRow, MessageRow } from "@/lib/api";
import { useDesigner } from "@/store/designerStore";

/**
 * Tenant chat view — channel rail + message stream.
 *
 * Polls the active channel every 5s for new messages. Compose box at
 * the bottom; Enter sends, Shift+Enter inserts a newline. Scrolls to
 * the bottom on new message arrival unless the user has scrolled up
 * (so reading history isn't interrupted).
 *
 * Channel CRUD via a small "+ Channel" button. Auto-creates `#general`
 * server-side on first request.
 */
export function MessagesView() {
  const currentUser = useDesigner((s) => s.currentUser);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Initial channel load.
  useEffect(() => {
    let alive = true;
    api.listChannels().then((list) => {
      if (!alive) return;
      setChannels(list);
      if (list.length > 0 && !activeId) setActiveId(list[0].id);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll messages for the active channel.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    async function refresh() {
      try {
        const r = await api.listChannelMessages(activeId!, { limit: 100 });
        if (!alive) return;
        setMessages(r.messages);
      } catch {
        /* ignore */
      }
    }
    void refresh();
    const i = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.clearInterval(i);
    };
  }, [activeId]);

  // Auto-scroll: when new messages arrive AND we were already at the
  // bottom, scroll to bottom. Otherwise leave the user where they are.
  useEffect(() => {
    if (!streamRef.current) return;
    if (stickToBottomRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages]);

  function onScroll() {
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  async function send() {
    if (!activeId || !draft.trim()) return;
    setBusy(true);
    try {
      const m = await api.postChannelMessage(activeId, draft.trim());
      setMessages((prev) => [...prev, m]);
      setDraft("");
      stickToBottomRef.current = true;
    } finally {
      setBusy(false);
    }
  }

  async function createChannel() {
    const slug = window.prompt("New channel slug (e.g. art, rules):");
    if (!slug) return;
    const cleaned = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleaned) return;
    const created = await api.createChannel({ slug: cleaned, name: cleaned });
    setChannels((prev) => [...prev, created]);
    setActiveId(created.id);
    setCreatingChannel(false);
  }

  const active = channels.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-full overflow-hidden bg-ink-950">
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-ink-400">
            Channels
          </span>
          <button
            type="button"
            onClick={createChannel}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
            disabled={creatingChannel}
          >
            + New
          </button>
        </header>
        <ul className="flex-1 overflow-y-auto py-1">
          {channels.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                className={[
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  activeId === c.id
                    ? "bg-accent-500/10 text-accent-200"
                    : "text-ink-200 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="text-ink-500">#</span>
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-2">
          <p className="text-sm font-medium text-ink-100">
            {active ? `#${active.name}` : "—"}
          </p>
          {active?.description && (
            <p className="text-[11px] text-ink-500">{active.description}</p>
          )}
        </header>

        <div
          ref={streamRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto p-4"
        >
          {messages.length === 0 ? (
            <p className="text-center text-sm text-ink-500">
              No messages yet — say hi.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <MessageItem
                  key={m.id}
                  m={m}
                  isOwn={currentUser?.id === m.authorId}
                />
              ))}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="border-t border-ink-800 bg-ink-900 p-3"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={active ? `Message #${active.name}…` : "Pick a channel"}
            disabled={!active || busy}
            rows={2}
            className="block w-full resize-none rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Enter to send · Shift+Enter for newline
          </p>
        </form>
      </div>
    </div>
  );
}

function MessageItem({ m, isOwn }: { m: MessageRow; isOwn: boolean }) {
  const initials = (m.author.displayName ?? m.author.name)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <li className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-700 bg-ink-800">
        {m.author.avatarAssetId ? (
          <img
            src={api.assetBlobUrl(m.author.avatarAssetId)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[10px] font-semibold text-ink-300">
            {initials || "?"}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className={`text-xs font-medium ${isOwn ? "text-accent-300" : "text-ink-100"}`}>
            {m.author.displayName ?? m.author.name}
          </span>
          <span className="text-[10px] text-ink-500">
            {new Date(m.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </p>
        <p
          className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-200"
          dangerouslySetInnerHTML={{ __html: m.bodyHtml || escapeHtml(m.body) }}
        />
      </div>
    </li>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
