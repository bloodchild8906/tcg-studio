/**
 * Platform admin view (sec 9.2).
 *
 * Cross-tenant management surface, only reachable when the signed-in
 * user has a non-null `platformRole`. The DesignerApp gates access
 * by checking that role on boot; this component itself trusts the
 * gate and just renders the three tabs:
 *
 *   • Tenants      — directory + status management
 *   • Billing      — plan distribution + MRR snapshot
 *   • Marketing    — platform-wide announcement banner CRUD
 *
 * The platform CMS lives separately (it's the same CmsView the
 * tenant uses, just pointed at the configured PLATFORM_TENANT_SLUG)
 * so we don't duplicate it here.
 */

import { useEffect, useState } from "react";
import * as api from "@/lib/api";

type Tab = "tenants" | "billing" | "marketing" | "marketplace";

export function PlatformView() {
  const [tab, setTab] = useState<Tab>("tenants");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-medium text-ink-100">Platform admin</h1>
          <p className="text-[11px] text-ink-500">
            Cross-tenant directory, billing roll-up, and marketing
            announcements. Only platform owners + admins can mutate;
            support reps see read-only.
          </p>
        </div>
        <nav className="flex gap-1 rounded border border-ink-800 bg-ink-950 p-1 text-xs">
          {(["tenants", "billing", "marketing", "marketplace"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={[
                "rounded px-3 py-1 transition-colors capitalize",
                tab === k
                  ? "bg-accent-500/20 text-accent-200"
                  : "text-ink-400 hover:text-ink-200",
              ].join(" ")}
            >
              {k}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "tenants" && <TenantsTab />}
        {tab === "billing" && <BillingTab />}
        {tab === "marketing" && <MarketingTab />}
        {tab === "marketplace" && <MarketplaceTab />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Tenants directory                                                      */
/* ---------------------------------------------------------------------- */

function TenantsTab() {
  const [rows, setRows] = useState<api.PlatformTenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      setRows(await api.listPlatformTenants());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setStatus(t: api.PlatformTenantRow, status: string) {
    if (
      !confirm(
        `Set ${t.slug} → ${status}? This affects every member of the workspace.`,
      )
    )
      return;
    try {
      await api.updatePlatformTenant(t.id, { status });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    }
  }

  // Header strip — always visible, even on empty + loading states so
  // the operator can mint a tenant before there's anything to list.
  const header = (
    <div className="flex items-center justify-between">
      <p className="text-[11px] uppercase tracking-wider text-ink-500">
        {rows == null ? "Loading…" : `${rows.length} tenant${rows.length === 1 ? "" : "s"}`}
      </p>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
      >
        + Create tenant
      </button>
    </div>
  );

  if (!rows) {
    return (
      <section className="space-y-3">
        {header}
        {creating && (
          <CreateTenantModal
            onClose={() => setCreating(false)}
            onCreated={async () => {
              setCreating(false);
              await refresh();
            }}
          />
        )}
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        {header}
        <div className="rounded border border-dashed border-ink-800 bg-ink-900/30 px-6 py-12 text-center">
          <p className="text-sm text-ink-300">No tenants yet.</p>
          <p className="mt-1 text-xs text-ink-500">
            Click <span className="font-medium text-ink-300">+ Create tenant</span>{" "}
            above to mint the first one.
          </p>
        </div>
        {creating && (
          <CreateTenantModal
            onClose={() => setCreating(false)}
            onCreated={async () => {
              setCreating(false);
              await refresh();
            }}
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {header}
      {creating && (
        <CreateTenantModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}
      <div className="overflow-hidden rounded border border-ink-800">
        <table className="w-full text-xs">
          <thead className="bg-ink-900 text-[10px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">Tenant</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Plan</th>
              <th className="px-3 py-2 text-right">Members</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {rows.map((t) => (
              <tr key={t.id} className="bg-ink-950 text-ink-200">
                <td className="px-3 py-2">
                  <div className="font-medium text-ink-100">{t.name}</div>
                  <div className="font-mono text-[10px] text-ink-500">{t.slug}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-3 py-2">
                  {t.plan ? t.plan.name : <span className="text-ink-600">—</span>}
                </td>
                <td className="px-3 py-2 text-right">{t._count.memberships}</td>
                <td className="px-3 py-2 text-[10px] text-ink-500">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {t.status !== "suspended" && (
                      <button
                        type="button"
                        onClick={() => setStatus(t, "suspended")}
                        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/20"
                      >
                        Suspend
                      </button>
                    )}
                    {t.status !== "active" && (
                      <button
                        type="button"
                        onClick={() => setStatus(t, "active")}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : status === "trial"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
        : status === "suspended" || status === "past_due"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : status === "disabled" || status === "pending_deletion"
            ? "border-danger-500/40 bg-danger-500/10 text-danger-300"
            : "border-ink-700 bg-ink-800 text-ink-400";
  return (
    <span
      className={[
        "inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
        tone,
      ].join(" ")}
    >
      {status}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Billing roll-up                                                        */
/* ---------------------------------------------------------------------- */

function BillingTab() {
  const [data, setData] = useState<api.PlatformBillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchPlatformBillingSummary()
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "load failed"),
      );
  }, []);

  if (!data) {
    return error ? (
      <p className="text-xs text-danger-400">{error}</p>
    ) : (
      <p className="text-sm text-ink-500">Loading…</p>
    );
  }

  const mrrUsd = (data.monthlyRecurringCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total tenants" value={String(data.totalTenants)} />
        <Stat
          label="Active + trial"
          value={String(data.activeTenants)}
          hint={`${data.totalTenants - data.activeTenants} other`}
        />
        <Stat label="MRR" value={mrrUsd} hint="paid plans only" />
      </div>

      <div className="rounded border border-ink-800 bg-ink-900 p-4">
        <h3 className="mb-3 text-xs uppercase tracking-wider text-ink-500">
          Plan distribution
        </h3>
        {data.planDistribution.length === 0 ? (
          <p className="text-sm text-ink-500">No tenants on any plan yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.planDistribution.map((p) => {
              const pct =
                data.totalTenants > 0
                  ? (p.count / data.totalTenants) * 100
                  : 0;
              return (
                <li key={p.slug} className="text-xs">
                  <div className="flex justify-between text-ink-200">
                    <span className="font-mono">{p.slug}</span>
                    <span className="text-ink-500">
                      {p.count} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-ink-800">
                    <div
                      className="h-full bg-accent-500/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded border border-ink-800 bg-ink-900 p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-ink-100">{value}</p>
      {hint && <p className="text-[10px] text-ink-500">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Marketing announcements                                                */
/* ---------------------------------------------------------------------- */

function MarketingTab() {
  const [rows, setRows] = useState<api.PlatformAnnouncement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      setRows(await api.listPlatformAnnouncements());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">
          Announcements pin to the top of every tenant's admin shell while
          they're <code className="text-ink-300">active</code> and within
          their window.
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
        >
          New announcement
        </button>
      </div>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}

      {creating && (
        <AnnouncementForm
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}

      {rows.length === 0 && !creating ? (
        <p className="text-sm text-ink-500">No announcements yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <AnnouncementRow key={r.id} row={r} onChanged={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AnnouncementRow({
  row,
  onChanged,
}: {
  row: api.PlatformAnnouncement;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const tone =
    row.status === "active"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : row.status === "archived"
        ? "border-ink-700 bg-ink-900 opacity-60"
        : "border-amber-500/40 bg-amber-500/5";

  async function destroy() {
    if (!confirm(`Delete "${row.headline}"?`)) return;
    try {
      await api.deletePlatformAnnouncement(row.id);
      await onChanged();
    } catch (e) {
      console.error(e);
    }
  }

  async function flip(status: api.PlatformAnnouncement["status"]) {
    try {
      await api.updatePlatformAnnouncement(row.id, { status });
      await onChanged();
    } catch (e) {
      console.error(e);
    }
  }

  if (editing) {
    return (
      <li>
        <AnnouncementForm
          row={row}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      </li>
    );
  }

  return (
    <li className={["rounded border p-3 text-xs text-ink-300", tone].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
              {row.kind}
            </span>
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
              {row.status}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-ink-100">{row.headline}</p>
          {row.body && (
            <p className="mt-1 text-[11px] text-ink-300">{row.body}</p>
          )}
          {(row.startsAt || row.endsAt) && (
            <p className="mt-1 text-[10px] text-ink-500">
              {row.startsAt
                ? new Date(row.startsAt).toLocaleString()
                : "anytime"}
              {" → "}
              {row.endsAt ? new Date(row.endsAt).toLocaleString() : "open-ended"}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700"
          >
            Edit
          </button>
          {row.status !== "active" && (
            <button
              type="button"
              onClick={() => flip("active")}
              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
            >
              Activate
            </button>
          )}
          {row.status === "active" && (
            <button
              type="button"
              onClick={() => flip("archived")}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={destroy}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-0.5 text-[10px] text-danger-400 hover:bg-danger-500/20"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function AnnouncementForm({
  row,
  onCancel,
  onSaved,
}: {
  row?: api.PlatformAnnouncement;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<api.PlatformAnnouncement["kind"]>(
    row?.kind ?? "info",
  );
  const [headline, setHeadline] = useState(row?.headline ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [ctaLabel, setCtaLabel] = useState(row?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(row?.ctaUrl ?? "");
  const [status, setStatus] = useState<api.PlatformAnnouncement["status"]>(
    row?.status ?? "draft",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind,
        headline,
        body,
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
        status,
      };
      if (row) {
        await api.updatePlatformAnnouncement(row.id, payload);
      } else {
        await api.createPlatformAnnouncement(payload);
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-accent-500/40 bg-accent-500/5 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={kind}
          onChange={(e) =>
            setKind(e.target.value as api.PlatformAnnouncement["kind"])
          }
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
        >
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="maintenance">maintenance</option>
          <option value="marketing">marketing</option>
        </select>
        <select
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as api.PlatformAnnouncement["status"])
          }
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </div>
      <input
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="Headline"
        className="block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Optional body — markdown allowed"
        rows={3}
        className="block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={ctaLabel}
          onChange={(e) => setCtaLabel(e.target.value)}
          placeholder="CTA label (optional)"
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
        />
        <input
          value={ctaUrl}
          onChange={(e) => setCtaUrl(e.target.value)}
          placeholder="CTA URL"
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
        />
      </div>
      {error && <p className="text-[11px] text-danger-400">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-ink-800 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-300 hover:bg-ink-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !headline.trim()}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
        >
          {busy ? "Saving…" : row ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Marketplace — submissions queue + platform direct-upload (#180)        */
/* ---------------------------------------------------------------------- */

function MarketplaceTab() {
  // Two sub-views — the review queue is the default landing because
  // that's the time-sensitive surface (tenants are waiting), and
  // direct-upload is the create-first-party flow that platform admins
  // use less frequently.
  const [view, setView] = useState<"queue" | "upload">("queue");
  return (
    <section className="space-y-4">
      <nav className="flex gap-2 text-xs">
        {(["queue", "upload"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={[
              "rounded border px-3 py-1.5",
              view === k
                ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
                : "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700",
            ].join(" ")}
          >
            {k === "queue" ? "Review queue" : "Direct upload"}
          </button>
        ))}
      </nav>
      {view === "queue" ? <SubmissionsQueue /> : <DirectUpload />}
    </section>
  );
}

function SubmissionsQueue() {
  const [filter, setFilter] = useState<"review" | "approved" | "draft" | "all">(
    "review",
  );
  const [rows, setRows] = useState<api.PlatformMarketplaceSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows(await api.listPlatformMarketplaceSubmissions(filter));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function approve(id: string) {
    setActingId(id);
    try {
      await api.approvePlatformSubmission(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "approve failed");
    } finally {
      setActingId(null);
    }
  }
  async function reject(id: string) {
    const reason = window.prompt(
      "Reject reason (shown to submitter via audit log):",
      "",
    );
    if (reason === null) return; // user hit cancel
    setActingId(id);
    try {
      await api.rejectPlatformSubmission(id, reason);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "reject failed");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-ink-400">Filter:</span>
        {(["review", "approved", "draft", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={[
              "rounded px-2 py-0.5",
              filter === f
                ? "bg-accent-500/20 text-accent-200"
                : "text-ink-400 hover:text-ink-200",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-ink-300 hover:bg-ink-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}

      {!rows && <p className="text-sm text-ink-500">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-ink-500">
          No {filter === "all" ? "" : `${filter} `}submissions.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 rounded border border-ink-700 bg-ink-900 p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-100">{s.name}</span>
                  <span className="font-mono text-[10px] text-ink-500">
                    {s.kind}
                  </span>
                  <span
                    className={[
                      "rounded px-1.5 py-0.5 text-[10px]",
                      s.status === "review" && "bg-amber-500/20 text-amber-300",
                      s.status === "approved" && "bg-emerald-500/20 text-emerald-300",
                      s.status === "draft" && "bg-ink-700 text-ink-300",
                      s.status === "deprecated" && "bg-ink-800 text-ink-500",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-400">{s.summary}</p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {s.submittingTenant ? (
                    <>
                      From{" "}
                      <span className="text-ink-300">
                        {s.submittingTenant.name}
                      </span>{" "}
                      <span className="font-mono text-ink-500">
                        ({s.submittingTenant.slug})
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-500">Platform-owned</span>
                  )}
                  {" · "}
                  <span>slug: <code>{s.slug}</code></span>
                  {" · "}
                  <span>submitted {new Date(s.createdAt).toLocaleString()}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {s.status === "review" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void approve(s.id)}
                      disabled={actingId === s.id}
                      className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject(s.id)}
                      disabled={actingId === s.id}
                      className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectUpload() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("frame_pack");
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priceCents, setPriceCents] = useState(0);
  const [authorName, setAuthorName] = useState("TCGStudio");
  const [version, setVersion] = useState("1.0.0");
  const [contentJson, setContentJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      let parsed: unknown = {};
      if (contentJson.trim()) {
        try {
          parsed = JSON.parse(contentJson);
        } catch {
          throw new Error("contentJson isn't valid JSON.");
        }
      }
      const pkg = await api.createPlatformPackage({
        slug,
        name,
        kind,
        category: category || undefined,
        summary,
        description,
        priceCents,
        authorName,
        version: version
          ? { version, changelog: "Initial release.", contentJson: parsed }
          : undefined,
      });
      setSuccess(`Published ${pkg.name} (${pkg.slug}).`);
      // Clear the form so the operator can punch in another one
      // without accidentally double-publishing.
      setSlug("");
      setName("");
      setSummary("");
      setDescription("");
      setContentJson("{}");
    } catch (e) {
      setError(e instanceof Error ? e.message : "publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3 text-xs">
      <p className="rounded border border-accent-500/20 bg-accent-500/5 px-3 py-2 text-[11px] text-ink-300">
        Platform admins publish first-party packages directly here — no
        submitting tenant, auto-approved on create. For tenant-submitted
        packages use the <span className="text-accent-300">Review queue</span>{" "}
        tab.
      </p>

      <Field label="Slug" hint="lowercase + hyphens, must be unique across the platform">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          className={INPUT}
          required
        />
      </Field>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} required />
      </Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT}>
          {[
            "plugin",
            "frame_pack",
            "icon_pack",
            "font_pack",
            "rules_pack",
            "ability_pack",
            "exporter",
            "starter_kit",
            "cms_theme",
            "cms_block_pack",
            "board_layout",
            "print_profile",
            "pack_generator",
          ].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Category">
        <input value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT} placeholder="Visuals, Production, …" />
      </Field>
      <Field label="Summary">
        <input value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT} maxLength={500} />
      </Field>
      <Field label="Description (markdown)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={INPUT}
          rows={4}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (cents)">
          <input
            type="number"
            min={0}
            value={priceCents}
            onChange={(e) => setPriceCents(Math.max(0, Number(e.target.value) || 0))}
            className={INPUT}
          />
        </Field>
        <Field label="Author display name">
          <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} className={INPUT} />
        </Field>
      </div>

      <div className="rounded border border-ink-700 bg-ink-900 p-3">
        <p className="text-[11px] uppercase tracking-wider text-ink-400">
          First version (optional)
        </p>
        <Field label="Version" hint="Semver — e.g. 1.0.0">
          <input value={version} onChange={(e) => setVersion(e.target.value)} className={INPUT} />
        </Field>
        <Field label="contentJson" hint="Package payload — shape depends on kind">
          <textarea
            value={contentJson}
            onChange={(e) => setContentJson(e.target.value)}
            className={[INPUT, "font-mono text-[11px]"].join(" ")}
            rows={6}
          />
        </Field>
      </div>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !slug.trim() || !name.trim()}
        className="rounded-md bg-accent-500 px-4 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-400 disabled:opacity-50"
      >
        {busy ? "Publishing…" : "Publish package"}
      </button>
    </form>
  );
}

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

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
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

/**
 * Mint a new tenant from the Platform admin. The backend POST /api/v1/tenants
 * does the heavy lifting (creates the tenant row, seeds the default CMS site
 * + landing + login pages via ensureDefaultCmsContent, makes the calling user
 * the tenant_owner). This modal just collects the minimum fields needed:
 *
 *   - name : human-facing display, "Acme Studio"
 *   - slug : URL-safe, "acme"  → resolves at `acme.tcgstudio.online`
 *   - type : archetype (studio/publisher/etc.) — drives the dashboard preset
 *
 * Slug autosaves from name (lowercase, hyphenated) but is editable.
 */
function CreateTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tenantType, setTenantType] = useState<
    "studio" | "solo" | "publisher" | "school" | "reseller"
  >("studio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether the operator typed into the slug field directly. If
  // they did, we stop auto-syncing from name → slug so we don't clobber
  // their manual choice mid-typing.
  const [slugDirty, setSlugDirty] = useState(false);

  function autoSlug(v: string): string {
    return v
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTenant({
        name: name.trim(),
        slug: slug.trim() || autoSlug(name),
        tenantType,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[480px] rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-50">Create tenant</h2>
            <p className="text-[11px] text-ink-500">
              Mints a new workspace and seeds its default CMS site, landing, and
              login pages.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
          >
            ×
          </button>
        </div>

        <Field label="Display name" hint="What you'll call the tenant in the UI.">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugDirty) setSlug(autoSlug(e.target.value));
            }}
            required
            autoFocus
            placeholder="Acme Studio"
            className="block w-full rounded border border-ink-700 bg-ink-800 px-2.5 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
        </Field>

        <Field
          label="Slug"
          hint={`URL-safe identifier. Will resolve at ${slug || "<slug>"}.tcgstudio.online`}
        >
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(autoSlug(e.target.value));
              setSlugDirty(true);
            }}
            required
            placeholder="acme"
            pattern="[a-z0-9][a-z0-9-]*"
            className="block w-full rounded border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
        </Field>

        <Field
          label="Tenant type"
          hint="Drives the dashboard preset and default nav grouping."
        >
          <select
            value={tenantType}
            onChange={(e) =>
              setTenantType(e.target.value as typeof tenantType)
            }
            className="block w-full rounded border border-ink-700 bg-ink-800 px-2.5 py-2 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          >
            <option value="studio">Indie studio</option>
            <option value="solo">Solo creator</option>
            <option value="publisher">Publisher (multi-game)</option>
            <option value="school">School / university</option>
            <option value="reseller">Reseller / white-label</option>
          </select>
        </Field>

        {error && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim() || !slug.trim()}
            className="rounded-md bg-accent-500 px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-400 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create tenant"}
          </button>
        </div>
      </form>
    </div>
  );
}
