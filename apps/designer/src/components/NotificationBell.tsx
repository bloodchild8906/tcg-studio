import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { NotificationRow } from "@/lib/api";
import { realtime, channels } from "@/lib/realtime";
import { useDesigner } from "@/store/designerStore";

/**
 * Header notification bell.
 *
 * Polls /api/v1/notifications every 30s for unread count + the most
 * recent rows. Click opens a dropdown showing the latest items;
 * clicking an item marks it read AND navigates to its `link` (if
 * present). "Mark all read" hits the bulk endpoint.
 *
 * Polling cadence is intentionally relaxed — this is an authenticated
 * endpoint and the goal is "the badge updates within a minute or two
 * of an event", not real-time. If/when we add WebSockets for live
 * updates, swap the interval for a subscribe.
 */
export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Load once on mount, then subscribe to realtime push for new
  // notifications. The 30s poll is gone — the WS bridge updates the
  // bell within ~50ms of the row being inserted server-side.
  const currentUser = useDesigner((s) => s.currentUser);
  const activeTenant = useDesigner((s) => {
    return s.tenants.find((t) => t.slug === s.activeTenantSlug) ?? null;
  });

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const r = await api.listNotifications({ limit: 20 });
        if (!alive) return;
        setItems(r.notifications);
        setUnreadCount(r.unreadCount);
      } catch {
        /* ignore — the bell is non-critical */
      }
    }
    void refresh();
    return () => {
      alive = false;
    };
  }, []);

  // Realtime subscription — push new rows to the top of the list as
  // they arrive on the user's personal channel.
  useEffect(() => {
    if (!currentUser || !activeTenant) return;
    const ch = channels.user(activeTenant.id, currentUser.id);
    return realtime.subscribe(ch, (event) => {
      if (event.kind !== "notification.created") return;
      const notif = (event.payload as { notification?: NotificationRow } | null)
        ?.notification;
      if (!notif) return;
      setItems((prev) => {
        if (prev.some((x) => x.id === notif.id)) return prev;
        return [notif, ...prev].slice(0, 50);
      });
      if (!notif.readAt) setUnreadCount((c) => c + 1);
    });
  }, [currentUser, activeTenant]);

  // Outside-click dismiss.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleClick(n: NotificationRow) {
    if (!n.readAt) {
      try {
        await api.markNotificationRead(n.id);
      } catch {
        /* non-fatal */
      }
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      );
      setUnreadCount(Math.max(0, unreadCount - 1));
    }
    if (n.link) {
      // External-looking links open in a new tab; in-app links navigate
      // (we don't have a router so use location.assign which preserves
      // SPA boot — the destination router will pick it up).
      if (/^https?:\/\//.test(n.link)) {
        window.open(n.link, "_blank", "noreferrer");
      } else {
        window.location.assign(n.link);
      }
    }
    setOpen(false);
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* ignore */
    }
    setItems((prev) =>
      prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })),
    );
    setUnreadCount(0);
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        title={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
        className="relative flex h-8 w-8 items-center justify-center rounded text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-semibold text-ink-950">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={dropdownRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <p className="text-xs font-medium text-ink-100">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-[11px] text-accent-300 hover:text-accent-200"
              >
                Mark all read
              </button>
            )}
          </header>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-ink-500">
                You're all caught up.
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={[
                    "block w-full px-3 py-2 text-left",
                    n.readAt ? "opacity-60" : "",
                    "hover:bg-ink-800",
                  ].join(" ")}
                >
                  <p className="flex items-start gap-2">
                    {!n.readAt && (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400"
                      />
                    )}
                    <span className="flex-1 text-xs font-medium text-ink-100">
                      {n.title}
                    </span>
                  </p>
                  {n.body && (
                    <p className="ml-3.5 mt-0.5 text-[11px] text-ink-400">
                      {n.body}
                    </p>
                  )}
                  <p className="ml-3.5 mt-1 text-[10px] text-ink-500">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.5 11h9l-1-1.5V7a3.5 3.5 0 0 0-7 0v2.5L3.5 11z" />
      <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}
