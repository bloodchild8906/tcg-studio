import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { CreatedWebhook, WebhookDelivery, WebhookRow } from "@/lib/api";

/**
 * Webhook management panel (sec 36).
 *
 * Lists tenant webhook subscriptions with enable/disable, delivery
 * history, secret rotation, and a test ping. Same one-time-display
 * pattern as API keys: the signing secret is shown immediately after
 * creation and never again — receivers verify the
 * X-Tcgs-Signature header against it.
 */
export function WebhooksSection() {
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandId, setExpandId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setHooks(await api.listWebhooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(h: WebhookRow) {
    await api.updateWebhook(h.id, { enabled: !h.enabled });
    await refresh();
  }
  async function destroy(h: WebhookRow) {
    if (!confirm(`Delete webhook "${h.name}"? Any pending deliveries are lost.`)) return;
    await api.deleteWebhook(h.id);
    await refresh();
  }
  async function ping(h: WebhookRow) {
    await api.pingWebhook(h.id);
    setExpandId(h.id);
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink-100">Webhooks</h3>
          <p className="text-[11px] text-ink-500">
            POST tenant events to your URL when things happen — page
            publishes, API key creation, and more. Signed with HMAC-SHA256
            so receivers can verify the request came from us.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
        >
          + New webhook
        </button>
      </header>

      {error && (
        <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm text-ink-500">Loading…</p>
      ) : hooks.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">
          No webhooks configured.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {hooks.map((h) => (
            <li key={h.id}>
              <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-ink-100">
                    {h.name}
                    {!h.enabled && (
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
                        disabled
                      </span>
                    )}
                    {h.consecutiveFailures > 0 && (
                      <span
                        className="rounded bg-danger-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger-300"
                        title={`${h.consecutiveFailures} consecutive failure(s)`}
                      >
                        ⚠ {h.consecutiveFailures}
                      </span>
                    )}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-500">
                    {h.targetUrl}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-400">
                    Events:{" "}
                    {(h.events ?? []).map((e) => (
                      <code
                        key={e}
                        className="mr-1 rounded bg-ink-800 px-1 py-px font-mono text-[10px] text-ink-300"
                      >
                        {e}
                      </code>
                    ))}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {h.lastSuccessAt && (
                      <>
                        last success {new Date(h.lastSuccessAt).toLocaleString()}
                      </>
                    )}
                    {h.lastSuccessAt && h.lastFailureAt && " · "}
                    {h.lastFailureAt && (
                      <>last fail {new Date(h.lastFailureAt).toLocaleString()}</>
                    )}
                    {!h.lastSuccessAt && !h.lastFailureAt && "Never delivered"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => ping(h)}
                    disabled={!h.enabled}
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandId(expandId === h.id ? null : h.id)
                    }
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
                  >
                    {expandId === h.id ? "Hide" : "History"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(h)}
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
                  >
                    {h.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => destroy(h)}
                    className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expandId === h.id && <DeliveryList webhookId={h.id} />}
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateWebhookModal
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            setCreating(false);
            setCreated(c);
            await refresh();
          }}
        />
      )}

      {created && (
        <CreatedWebhookModal created={created} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}

/* ====================================================================== */
/* Create modal                                                            */
/* ====================================================================== */

const SUGGESTED_EVENTS = [
  "*",
  "apikey.*",
  "apikey.create",
  "apikey.revoke",
  "cms.*",
  "cms.page.publish",
  "cms.page.unpublish",
  "domain.*",
  "plugin.*",
  "task.assigned",
  "webhook.test",
];

function CreateWebhookModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: CreatedWebhook) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://");
  const [events, setEvents] = useState<Set<string>>(new Set(["*"]));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (events.size === 0) {
      setErr("Pick at least one event.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createWebhook({
        name,
        targetUrl,
        events: Array.from(events),
      });
      await onCreated(created);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleEvent(s: string) {
    const next = new Set(events);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setEvents(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[480px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">New webhook</h3>
        <Field label="Name (admin label)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Discord notifier, CI bot, etc."
            className={INPUT}
          />
        </Field>
        <Field label="Target URL" hint="HTTPS endpoint that receives the POST.">
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            required
            placeholder="https://example.com/hooks/tcgs"
            className={INPUT}
          />
        </Field>
        <fieldset className="mb-4">
          <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
            Events to fire on
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_EVENTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleEvent(s)}
                className={[
                  "rounded border px-2 py-0.5 font-mono text-[10px]",
                  events.has(s)
                    ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                    : "border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-700",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            <code className="font-mono">*</code> matches everything;{" "}
            <code className="font-mono">cms.*</code> matches one segment.
          </p>
        </fieldset>
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name || !targetUrl}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create webhook"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreatedWebhookModal({
  created,
  onClose,
}: {
  created: CreatedWebhook;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[560px] rounded-lg border border-emerald-500/40 bg-ink-900 p-5 shadow-2xl">
        <h3 className="mb-1 text-base font-medium text-emerald-300">
          Webhook created — save the secret
        </h3>
        <p className="mb-3 text-xs text-ink-400">
          The signing secret below is shown ONCE. Use it to verify the
          <code className="ml-1 font-mono text-ink-300">X-Tcgs-Signature</code>{" "}
          header on incoming requests:
          <code className="ml-1 font-mono text-ink-300">
            HMAC-SHA256(secret, `${"${t}.${rawBody}"}`)
          </code>
          .
        </p>
        <div className="rounded border border-ink-700 bg-ink-950 p-2.5 font-mono text-xs text-accent-300">
          {created.secret}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(created.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="mt-2 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs text-accent-300 hover:bg-accent-500/25"
        >
          {copied ? "Copied!" : "Copy secret"}
        </button>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Delivery history                                                        */
/* ====================================================================== */

function DeliveryList({ webhookId }: { webhookId: string }) {
  const [rows, setRows] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await api.listWebhookDeliveries(webhookId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhookId]);

  return (
    <div className="border-t border-ink-800 bg-ink-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-ink-400">
          Recent deliveries (last 100)
        </p>
        <button
          type="button"
          onClick={refresh}
          className="text-[11px] text-accent-300 hover:text-accent-200"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="py-3 text-center text-[11px] text-ink-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-ink-500">
          No deliveries yet — fire a test event with the Test button.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {rows.map((d) => (
            <li key={d.id} className="px-2 py-1.5">
              <button
                type="button"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                className="flex w-full items-baseline justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={[
                      "inline-block h-1.5 w-1.5 rounded-full",
                      d.ok ? "bg-emerald-400" : "bg-danger-400",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  <code className="font-mono text-[11px] text-accent-300">
                    {d.event}
                  </code>
                  <span className="text-[10px] text-ink-500">
                    {d.responseStatus ?? d.errorCode ?? "?"}
                    {d.durationMs != null && ` · ${d.durationMs}ms`}
                  </span>
                </span>
                <span className="text-[10px] text-ink-500">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </button>
              {expanded === d.id && (
                <pre className="mt-1.5 overflow-auto rounded border border-ink-800 bg-ink-900 p-2 font-mono text-[10px] text-ink-300">
                  {JSON.stringify(d.payloadJson, null, 2)}
                  {d.responseBody && (
                    <>
                      {"\n\n--- response body ---\n"}
                      {d.responseBody}
                    </>
                  )}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ====================================================================== */
/* Tiny helpers                                                            */
/* ====================================================================== */

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}
